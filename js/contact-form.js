/* =========================================================
   contact-form.js
   ---------------------------------------------------------
   Makes the contact form on contact.html actually go
   somewhere. Every submission is written to the
   contact_submissions table in Supabase and shows up in the
   admin panel under "Contact Messages", where it can be read,
   replied to, marked done, deleted individually, or cleared
   in bulk.

   Row Level Security on that table is one-way: the public may
   INSERT a message but may never SELECT one back. So visitors
   can send messages and nobody can read anyone else's.

   If Supabase isn't configured (or is unreachable), the form
   tells the visitor honestly that the message couldn't be
   sent and points them at the email address instead — it does
   NOT show a fake "sent!" confirmation for a message that
   went nowhere.
   ========================================================= */
(function () {
  "use strict";

  var SUCCESS_MSG = "ধন্যবাদ — আপনার মেসেজ পাঠানো হয়েছে। আমরা শীঘ্রই উত্তর দেব।";
  var FAIL_MSG = "মেসেজ পাঠানো যায়নি। অনুগ্রহ করে সরাসরি ইমেইল করুন।";

  function isConfigured() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && typeof window.supabase !== "undefined");
  }

  function notify(message, isError) {
    if (typeof window.showToast === "function") window.showToast(message);
    else alert(message);
    if (isError) console.warn("Shahedin contact form:", message);
  }

  function setFormMessage(form, text, isError) {
    var box = form.querySelector("[data-form-status]");
    if (!box) {
      box = document.createElement("p");
      box.setAttribute("data-form-status", "");
      box.className = "form-status";
      var btn = form.querySelector('button[type="submit"]');
      if (btn && btn.parentNode) btn.parentNode.insertBefore(box, btn.nextSibling);
      else form.appendChild(box);
    }
    box.textContent = text || "";
    box.classList.toggle("is-error", !!isError);
    box.style.display = text ? "" : "none";
  }

  async function submit(form, e) {
    e.preventDefault();

    // Let the browser's own required/type validation run first.
    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

    var btn = form.querySelector('button[type="submit"]');
    var originalLabel = btn ? btn.textContent : null;

    var payload = {
      name: value(form, "name"),
      email: value(form, "email"),
      inquiry_type: value(form, "inquiry_type") || "general",
      message: value(form, "message"),
      preferred_date: selectedCalendarDate(),
      source_page: location.pathname.split("/").pop() || "contact.html",
    };

    if (!payload.name || !payload.email || !payload.message) {
      setFormMessage(form, "অনুগ্রহ করে নাম, ইমেইল এবং মেসেজ পূরণ করুন।", true);
      return;
    }

    if (!isConfigured()) {
      setFormMessage(form, FAIL_MSG, true);
      notify(FAIL_MSG, true);
      return;
    }

    if (btn) {
      btn.textContent = "পাঠানো হচ্ছে...";
      btn.disabled = true;
    }
    setFormMessage(form, "");

    try {
      var client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      var res = await client.from("contact_submissions").insert(payload);

      if (res.error) throw res.error;

      if (btn) btn.textContent = "পাঠানো হয়েছে ✓";
      setFormMessage(form, SUCCESS_MSG, false);
      notify(form.dataset.successMessage || SUCCESS_MSG);

      form.reset();
      clearCalendarSelection();

      setTimeout(function () {
        if (btn) {
          btn.textContent = originalLabel;
          btn.disabled = false;
        }
      }, 1800);
    } catch (err) {
      if (btn) {
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
      setFormMessage(form, FAIL_MSG, true);
      notify(FAIL_MSG, true);
      console.warn("Shahedin: contact submission failed.", err);
    }
  }

  function value(form, fieldName) {
    var el = form.querySelector('[name="' + fieldName + '"]');
    return el ? String(el.value || "").trim() : "";
  }

  /* The contact page has a small "pick a day" calendar for speaking
     requests. If the visitor picked a day, send it along with the message
     so the admin sees which date they had in mind. */
  function selectedCalendarDate() {
    var picked = document.querySelector("[data-cal-grid] .cal-day.selected, [data-cal-grid] .cal-day.is-selected");
    return picked ? String(picked.textContent || "").trim() : null;
  }

  function clearCalendarSelection() {
    document.querySelectorAll("[data-cal-grid] .selected, [data-cal-grid] .is-selected").forEach(function (el) {
      el.classList.remove("selected", "is-selected");
    });
  }

  function init() {
    document.querySelectorAll("[data-contact-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        submit(form, e);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
