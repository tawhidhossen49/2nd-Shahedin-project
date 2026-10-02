/* =========================================================
   data.js — the empty shape every data-driven page starts from.
   ---------------------------------------------------------
   This file used to hold six sample courses and six sample
   products, and the site fell back to them whenever the live
   data was empty, slow or failed to load. Visitors then saw
   courses and products that do not exist. It now holds nothing:
   js/data-loader.js fills these arrays from Supabase, and an
   empty array renders as an empty state, never as a sample.
   Do not add sample rows back here.
   ========================================================= */
window.SITE_DATA = {
  courses: [],
  products: [],
};
