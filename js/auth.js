/* =========================================================
   auth.js
   ---------------------------------------------------------
   Shared student-account auth for the public site (separate
   from the admin panel's auth in /admin, which stays email +
   password). Students sign up and log in with just their name
   and phone number, verified with an SMS OTP — there's no
   password and no separate "sign up" vs "log in" step, since
   sending an OTP does both: a new phone creates the account,
   an existing phone just logs it back in.

   Requires phone auth to be turned on in the Supabase dashboard
   (Authentication → Providers → Phone), with an SMS provider
   (Twilio, MessageBird, Vonage, etc.) configured there — that
   part can't be done from code.

   Session persistence (staying logged in across visits until
   the person explicitly logs out) is handled automatically by
   the Supabase client itself; nothing extra is needed for that.

   Usage:
     await ShahedinAuth.getUser()          → current user or null
     ShahedinAuth.onChange(user => {...})  → fires on login/logout
     ShahedinAuth.requireAuth()            → resolves with the user,
                                              opening a login/signup
                                              modal first if needed
     ShahedinAuth.signOut()
   ========================================================= */
window.ShahedinAuth = (function () {
  "use strict";

  function configured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && typeof window.supabase !== "undefined");
  }

  let _client = null;
  function client() {
    if (!configured()) return null;
    if (!_client) _client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return _client;
  }

  async function getUser() {
    const c = client();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session ? data.session.user : null;
  }

  function onChange(cb) {
    const c = client();
    if (!c) return;
    c.auth.onAuthStateChange((_event, session) => cb(session ? session.user : null));
  }

  async function signOut() {
    const c = client();
    if (c) await c.auth.signOut();
  }

  async function updateProfile(fields) {
    const c = client();
    return c.auth.updateUser({ data: fields });
  }

  function displayName(user) {
    if (!user) return "";
    return (user.user_metadata && user.user_metadata.full_name) || formatPhone(user.phone) || "";
  }

  /* ---------- Bangladeshi phone number formatting ---------- */
  // Accepts "01712345678", "1712345678", "+8801712345678", "8801712345678",
  // with or without spaces/dashes — always normalizes to "+8801712345678".
  function normalizePhone(raw) {
    let digits = (raw || "").replace(/[^\d]/g, "");
    if (digits.startsWith("880")) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return "+880" + digits;
  }

  function isValidLocalPhone(raw) {
    const digits = (raw || "").replace(/[^\d]/g, "");
    return /^1[3-9]\d{8}$/.test(digits);
  }

  function formatPhone(e164) {
    if (!e164) return "";
    return e164.startsWith("+880") ? "0" + e164.slice(4) : e164; // "+8801712345678" → "01712345678" (local display)
  }

  function escapeHtml(str) {
    return (str == null ? "" : String(str)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  /* ---------- Shared login/signup form (used inline or inside a modal) ---------- */
  function renderAuthForm(container, opts) {
    opts = opts || {};
    let step = "phone"; // "phone" → "otp"
    let phone = "";
    let name = "";
    let resendTimer = null;

    function clearResendTimer() {
      if (resendTimer) clearInterval(resendTimer);
      resendTimer = null;
    }

    function paintPhoneStep() {
      container.innerHTML = `
        <div class="auth-error" hidden></div>
        <form class="auth-form">
          <div class="field"><label>নাম</label><input type="text" name="name" required autocomplete="name" value="${escapeHtml(name)}"></div>
          <div class="field">
            <label>ফোন নম্বর</label>
            <div class="phone-input-group">
              <span class="phone-prefix">+880</span>
              <input type="tel" name="phone" required inputmode="numeric" maxlength="11" placeholder="1XXXXXXXXX" autocomplete="tel">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block">OTP পাঠান</button>
        </form>`;

      const form = container.querySelector(".auth-form");
      const errEl = container.querySelector(".auth-error");

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errEl.hidden = true;
        const typedName = form.name.value.trim();
        const typedPhone = form.phone.value.trim();

        if (!typedName) {
          errEl.hidden = false;
          errEl.textContent = "আপনার নাম লিখুন।";
          return;
        }
        if (!isValidLocalPhone(typedPhone)) {
          errEl.hidden = false;
          errEl.textContent = "সঠিক একটি বাংলাদেশি মোবাইল নম্বর দিন (যেমন 017XXXXXXXX)।";
          return;
        }

        name = typedName;
        phone = normalizePhone(typedPhone);

        const btn = form.querySelector('button[type="submit"]');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "পাঠানো হচ্ছে…";

        try {
          await sendOtp();
          step = "otp";
          paintOtpStep();
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = translateAuthError(err.message);
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    }

    async function sendOtp() {
      const c = client();
      const { error } = await c.auth.signInWithOtp({ phone, options: { data: { full_name: name }, shouldCreateUser: true } });
      if (error) throw error;
    }

    function paintOtpStep() {
      container.innerHTML = `
        <div class="auth-error" hidden></div>
        <div class="auth-info" style="display:block;">+880 ${phone.slice(4)} নম্বরে একটি ৬-ডিজিটের OTP পাঠানো হয়েছে।</div>
        <form class="auth-form">
          <div class="field"><label>OTP কোড</label><input type="text" name="otp" required inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="——————"></div>
          <button type="submit" class="btn btn-primary btn-block">যাচাই করে চালিয়ে যান</button>
        </form>
        <div class="auth-otp-actions">
          <button type="button" class="auth-link-btn" data-change-number>নম্বর পরিবর্তন করুন</button>
          <button type="button" class="auth-link-btn" data-resend disabled>৩০ সেকেন্ড পর আবার পাঠান</button>
        </div>`;

      const form = container.querySelector(".auth-form");
      const errEl = container.querySelector(".auth-error");
      const resendBtn = container.querySelector("[data-resend]");
      const changeBtn = container.querySelector("[data-change-number]");

      let secondsLeft = 30;
      clearResendTimer();
      resendTimer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft <= 0) {
          clearResendTimer();
          resendBtn.disabled = false;
          resendBtn.textContent = "আবার পাঠান";
        } else {
          resendBtn.textContent = `${secondsLeft} সেকেন্ড পর আবার পাঠান`;
        }
      }, 1000);

      changeBtn.addEventListener("click", () => {
        clearResendTimer();
        step = "phone";
        paintPhoneStep();
      });

      resendBtn.addEventListener("click", async () => {
        if (resendBtn.disabled) return;
        resendBtn.disabled = true;
        try {
          await sendOtp();
          errEl.hidden = true;
          secondsLeft = 30;
          clearResendTimer();
          resendTimer = setInterval(() => {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
              clearResendTimer();
              resendBtn.disabled = false;
              resendBtn.textContent = "আবার পাঠান";
            } else {
              resendBtn.textContent = `${secondsLeft} সেকেন্ড পর আবার পাঠান`;
            }
          }, 1000);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = translateAuthError(err.message);
          resendBtn.disabled = false;
          resendBtn.textContent = "আবার পাঠান";
        }
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errEl.hidden = true;
        const token = form.otp.value.trim();
        if (!/^\d{4,8}$/.test(token)) {
          errEl.hidden = false;
          errEl.textContent = "OTP কোডটি সঠিকভাবে লিখুন।";
          return;
        }
        const btn = form.querySelector('button[type="submit"]');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "যাচাই হচ্ছে…";
        try {
          const c = client();
          const { data, error } = await c.auth.verifyOtp({ phone, token, type: "sms" });
          if (error) throw error;
          await c.auth.updateUser({ data: { full_name: name } }); // keep the name current whether this was a signup or a login
          clearResendTimer();
          if (opts.onSuccess) opts.onSuccess(data.user);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = translateAuthError(err.message);
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    }

    if (step === "phone") paintPhoneStep();
  }

  function translateAuthError(msg) {
    const m = (msg || "").toLowerCase();
    if (m.includes("token") && (m.includes("invalid") || m.includes("expired"))) return "OTP কোডটি সঠিক নয় অথবা মেয়াদ শেষ হয়ে গেছে — আবার চেষ্টা করুন।";
    if (m.includes("sms") || m.includes("provider")) return "OTP পাঠানো যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।";
    if (m.includes("rate limit") || m.includes("too many")) return "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।";
    if (m.includes("phone") && m.includes("valid")) return "সঠিক একটি ফোন নম্বর দিন।";
    return msg || "কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন।";
  }

  /* ---------- Modal wrapper ---------- */
  let _modalResolvers = [];

  function openModal() {
    if (!configured()) {
      window.showToast && window.showToast("সাইটটি এখনো Supabase-এর সাথে সংযুক্ত নয়।");
      return;
    }
    if (document.getElementById("authModal")) return;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop auth-modal-backdrop";
    backdrop.id = "authModal";
    backdrop.innerHTML = `
      <div class="modal auth-modal">
        <button type="button" class="modal-close auth-modal-close" aria-label="Close">&times;</button>
        <div class="auth-modal-brand"><span class="dot"></span>Shahedin</div>
        <p class="auth-otp-sub" style="text-align:center;">লগ ইন করতে বা নতুন অ্যাকাউন্ট খুলতে আপনার নাম ও ফোন নম্বর দিন।</p>
        <div class="auth-modal-body"></div>
      </div>`;
    document.body.appendChild(backdrop);

    function close(user) {
      backdrop.remove();
      _modalResolvers.forEach((r) => r(user || null));
      _modalResolvers = [];
    }

    backdrop.querySelector(".auth-modal-close").addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(null); });

    renderAuthForm(backdrop.querySelector(".auth-modal-body"), {
      onSuccess: (user) => close(user),
    });
  }

  function requireAuth() {
    return getUser().then((user) => {
      if (user) return user;
      return new Promise((resolve) => {
        _modalResolvers.push(resolve);
        openModal();
      });
    });
  }

  return { configured, client, getUser, onChange, signOut, updateProfile, displayName, formatPhone, renderAuthForm, openModal, requireAuth };
})();
