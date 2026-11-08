/* =========================================================
   api-client.js
   ---------------------------------------------------------
   Talks to the site's own server (api.shahedin.com) instead of
   Supabase. It offers the same calls the pages already use —
   window.supabase.createClient(url, key) and then .from(), .rpc(),
   .auth, .storage and .functions — so no other script had to change.
   Load it in place of the supabase-js <script> tag, before
   supabase-config.js.

   What it covers is exactly what the site uses:
     from(t).select/insert/upsert/update/delete
       .eq .neq .gt .gte .lt .lte .in .is .like .ilike .match
       .order .limit .range .single .maybeSingle
     rpc(name, args)
     auth: getSession getUser onAuthStateChange signInWithPassword
           signInWithOtp verifyOtp signInWithOAuth updateUser signOut
     storage.from(bucket).upload / getPublicUrl
     functions.invoke(name, { body })
   ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "shahedin.session";
  let apiUrl = "";
  let session = undefined;          // undefined = not read from storage yet
  const listeners = new Set();

  /* ---------- the saved login ---------- */

  function readSession() {
    if (session === undefined) {
      try { session = JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch (e) { session = null; }
    }
    return session;
  }

  function saveSession(s, event) {
    session = s;
    try {
      if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* private mode: the login lasts for this page only */ }
    listeners.forEach((cb) => { try { cb(event, s); } catch (e) { console.error(e); } });
  }

  // Another tab logged in or out: follow it.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY) return;
    session = undefined;
    const s = readSession();
    listeners.forEach((cb) => { try { cb(s ? "SIGNED_IN" : "SIGNED_OUT", s); } catch (err) { console.error(err); } });
  });

  /* ---------- talking to the server ---------- */

  function apiError(json, status) {
    const j = json && typeof json === "object" ? json : {};
    return {
      message: j.message || (status ? "Request failed (" + status + ")" : "Could not reach the server. Check your internet connection."),
      code: j.code || (status ? String(status) : ""),
      details: j.details || null,
      hint: j.hint || null,
      status: status || 0,
    };
  }

  /* Returns { status, json }. A login the server no longer knows (expired, or
     ended by a password change) is dropped, and the request is sent again as a
     visitor, which is what Supabase's client did too. */
  async function call(method, path, body, retried) {
    const s = readSession();
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (s && s.access_token) headers.Authorization = "Bearer " + s.access_token;
    let res;
    try {
      res = await fetch(apiUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      return { status: 0, json: null };
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty or not JSON */ }
    if (res.status === 401 && json && json.code === "bad_jwt" && s && !retried) {
      saveSession(null, "SIGNED_OUT");
      if (path === "/rest" || path.indexOf("/rpc/") === 0) return call(method, path, body, true);
    }
    return { status: res.status, json };
  }

  /* ---------- from("table") ---------- */

  class Query {
    constructor(table) {
      this.q = { table, method: "select", columns: "*", filters: [], order: [] };
    }

    select(columns, opts) {
      const o = opts || {};
      if (this.q.method === "select") {
        this.q.columns = columns || "*";
        if (o.count) this.q.count = o.count;
        if (o.head) this.q.head = true;
      } else {
        this.q.returning = true;     // insert(...).select(): send the saved rows back
        this.q.columns = columns || "*";
      }
      return this;
    }

    insert(values) { this.q.method = "insert"; this.q.values = values; return this; }
    upsert(values, opts) {
      this.q.method = "upsert";
      this.q.values = values;
      if (opts && opts.onConflict) this.q.on_conflict = opts.onConflict;
      return this;
    }
    update(values) { this.q.method = "update"; this.q.values = values; return this; }
    delete() { this.q.method = "delete"; return this; }

    _f(column, op, value) { this.q.filters.push([column, op, value]); return this; }
    eq(c, v) { return this._f(c, "eq", v); }
    neq(c, v) { return this._f(c, "neq", v); }
    gt(c, v) { return this._f(c, "gt", v); }
    gte(c, v) { return this._f(c, "gte", v); }
    lt(c, v) { return this._f(c, "lt", v); }
    lte(c, v) { return this._f(c, "lte", v); }
    in(c, v) { return this._f(c, "in", Array.from(v || [])); }
    is(c, v) { return this._f(c, "is", v); }
    like(c, v) { return this._f(c, "like", v); }
    ilike(c, v) { return this._f(c, "ilike", v); }
    match(obj) { Object.keys(obj || {}).forEach((k) => this.eq(k, obj[k])); return this; }

    order(column, opts) {
      this.q.order.push([column, !(opts && opts.ascending === false)]);
      return this;
    }
    limit(n) { this.q.limit = n; return this; }
    range(from, to) { this.q.offset = from; this.q.limit = to - from + 1; return this; }
    single() { this.q.single = "single"; return this; }
    maybeSingle() { this.q.single = "maybe"; return this; }

    // Nothing is sent until the query is awaited, exactly as with Supabase.
    then(onOk, onFail) { return this._run().then(onOk, onFail); }
    catch(onFail) { return this._run().catch(onFail); }

    async _run() {
      if (!this._promise) {
        this._promise = call("POST", "/rest", this.q).then(({ status, json }) => {
          if (status >= 200 && status < 300 && json) {
            return { data: json.data === undefined ? null : json.data, error: null, count: json.count == null ? null : json.count, status, statusText: "OK" };
          }
          return { data: null, error: apiError(json, status), count: null, status, statusText: "" };
        });
      }
      return this._promise;
    }
  }

  /* ---------- auth ---------- */

  function authResult(status, json) {
    if (status >= 200 && status < 300) {
      if (json && json.access_token) saveSession(json, "SIGNED_IN");
      return { data: { user: json ? json.user || null : null, session: json && json.access_token ? json : null }, error: null };
    }
    const err = apiError(json, status);
    err.name = "AuthApiError";
    return { data: { user: null, session: null }, error: err };
  }

  const auth = {
    async getSession() {
      await googleDone;   // a page opened by Google's redirect must see that login
      return { data: { session: readSession() }, error: null };
    },

    async getUser() {
      if (!readSession()) return { data: { user: null }, error: null };
      const { status, json } = await call("GET", "/auth/user");
      if (status === 200) return { data: { user: json }, error: null };
      return { data: { user: null }, error: apiError(json, status) };
    },

    onAuthStateChange(cb) {
      listeners.add(cb);
      // Supabase tells a new listener the current state straight away.
      googleDone.then(() => { if (listeners.has(cb)) cb("INITIAL_SESSION", readSession()); });
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },

    async signInWithPassword({ email, password }) {
      const { status, json } = await call("POST", "/auth/token", { email, password });
      return authResult(status, json);
    },

    async signInWithOtp({ phone, options }) {
      const { status, json } = await call("POST", "/auth/otp", { phone, options: options || {} });
      const r = authResult(status, json);
      return { data: { user: null, session: null }, error: r.error };
    },

    async verifyOtp({ phone, token }) {
      const { status, json } = await call("POST", "/auth/verify", { phone, token });
      return authResult(status, json);
    },

    async signInWithOAuth({ provider, options }) {
      if (provider !== "google") return { data: null, error: apiError({ message: "Unsupported provider", code: "provider_disabled" }, 400) };
      const back = (options && options.redirectTo) || location.href;
      const url = apiUrl + "/auth/google?redirect_to=" + encodeURIComponent(back);
      location.assign(url);
      return { data: { provider, url }, error: null };
    },

    async updateUser(fields) {
      const { status, json } = await call("PUT", "/auth/user", fields);
      if (status !== 200) return { data: { user: null }, error: apiError(json, status) };
      const s = readSession();
      if (s) saveSession(Object.assign({}, s, { user: json }), "USER_UPDATED");
      return { data: { user: json }, error: null };
    },

    async signOut() {
      if (readSession()) await call("POST", "/auth/logout", {});
      saveSession(null, "SIGNED_OUT");
      return { error: null };
    },
  };

  /* Google sends the browser back with the login in the #fragment.
     Keep it, clean the address bar, and announce the login. */
  async function finishGoogleLogin() {
    const h = location.hash.slice(1);
    if (!/(^|&)(access_token|error)=/.test(h)) return;
    const p = new URLSearchParams(h);
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("error")) {
      setTimeout(() => window.showToast && window.showToast("Google দিয়ে লগইন হয়নি, আবার চেষ্টা করুন।"), 500);
      return;
    }
    const token = p.get("access_token");
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token || "")) return;
    session = { access_token: token, token_type: "bearer", expires_at: Number(p.get("expires_at")) || null, user: null };
    const { status, json } = await call("GET", "/auth/user");
    if (status === 200) saveSession(Object.assign(session, { user: json }), "SIGNED_IN");
    else saveSession(null, "SIGNED_OUT");
  }

  /* Once per page, ask the server whether the saved login is still good, so a
     login ended elsewhere shows as logged out instead of half-working. */
  let checked = null;
  let googleDone = Promise.resolve();
  function checkSavedLogin() {
    if (checked) return checked;
    googleDone = finishGoogleLogin().catch(() => {});
    checked = (async () => {
      await googleDone;
      if (!readSession()) return;
      const { status, json } = await call("GET", "/auth/user");
      if (status === 200 && readSession()) saveSession(Object.assign({}, readSession(), { user: json }), "TOKEN_REFRESHED");
      // A 401 already logged the person out inside call().
    })();
    return checked;
  }

  /* ---------- storage ---------- */

  const storage = {
    from(bucket) {
      return {
        async upload(path, file, opts) {
          const s = readSession();
          const form = new FormData();
          form.append("bucket", bucket);
          form.append("path", path);
          form.append("file", file);
          if (opts && opts.contentType) form.append("content_type", opts.contentType);
          let res;
          try {
            res = await fetch(apiUrl + "/storage/upload", {
              method: "POST",
              headers: s && s.access_token ? { Authorization: "Bearer " + s.access_token } : {},
              body: form,
            });
          } catch (e) {
            return { data: null, error: apiError(null, 0) };
          }
          let json = null;
          try { json = await res.json(); } catch (e) { /* not JSON */ }
          if (!res.ok) return { data: null, error: apiError(json, res.status) };
          return { data: { path: (json && json.path) || path }, error: null };
        },
        getPublicUrl(path) {
          // One bucket ("media"), served straight from api.shahedin.com/media/<path>.
          const base = apiUrl + "/media/";
          return { data: { publicUrl: base + String(path).split("/").map(encodeURIComponent).join("/") } };
        },
      };
    },
  };

  /* ---------- functions (bKash, Meta, admin team) ---------- */

  const functions = {
    /* Like Supabase: a reply that is not 2xx comes back as an error whose
       .context is the unread Response, so the pages can read the reason. */
    async invoke(name, opts) {
      const s = readSession();
      const headers = { "Content-Type": "application/json" };
      if (s && s.access_token) headers.Authorization = "Bearer " + s.access_token;
      let res;
      try {
        res = await fetch(apiUrl + "/functions/" + encodeURIComponent(name), {
          method: "POST",
          headers,
          body: JSON.stringify((opts && opts.body) || {}),
        });
      } catch (e) {
        return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function", context: e } };
      }
      if (!res.ok) {
        return { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: res } };
      }
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      return { data, error: null };
    },
  };

  /* ---------- the client ---------- */

  function createClient(url) {
    apiUrl = String(url || "").replace(/\/+$/, "");
    checkSavedLogin();
    return {
      from: (table) => new Query(table),
      async rpc(name, args) {
        const { status, json } = await call("POST", "/rpc/" + encodeURIComponent(name), args || {});
        if (status >= 200 && status < 300) return { data: json, error: null, status };
        return { data: null, error: apiError(json, status), status };
      },
      auth,
      storage,
      functions,
    };
  }

  window.supabase = { createClient };
})();
