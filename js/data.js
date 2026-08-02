/* =========================================================
   data.js — shared demo content used by data-driven pages
   (course catalog, store, dashboard). Replace with real API
   data later; the front-end logic already reads from here.

   LANGUAGE: Bangla-first. Every visitor-facing string here is
   Bangla. The keys that are NOT prose are deliberately left in
   their original form because other code parses them:

     id        -> URL param, enrolment record, cart key
     category  -> data-category filter value
     type      -> data-type filter value (digital / physical)
     free      -> data-price filter value (free / paid)
     duration  -> parsed by durationBn() in render.js, which
                  converts "8h 45m" to "৮ ঘণ্টা ৪৫ মিনিট" at
                  render time. Writing Bangla here would bypass
                  that conversion, so the ASCII form stays.
     "20:11"   -> lesson lengths, converted by bnNum() the same way.

   Latin fragments that ARE kept inside Bangla prose (PDF, bKash)
   are intentional: --font-mixed in tokens.css exists to set them
   on the same optical baseline as the Bangla around them.
   ========================================================= */
window.SITE_DATA = {
  courses: [
    {
      id: "geo-101",
      courseType: "foundation",
      title: "জিওপলিটিক্স ১০১: বিশ্ব মানচিত্র পড়ার পাঠ",
      price: 0,
      free: true,
      duration: "3h 20m",
      rating: 4.9,
      students: 12400,
      tone: 1,
      category: "politics",
      desc: "বিশ্ব রাজনীতিতে ক্ষমতা আসলে কীভাবে চলে — সীমান্ত, সম্পদ ও জোট নিয়ে একটি মৌলিক কোর্স।",
      modules: [
        { title: "ভূগোল কেন আজও রাজনীতি নিয়ন্ত্রণ করে", lessons: [["ভূমিকা ও কোর্সের রূপরেখা", "6:12", true], ["হার্টল্যান্ড তত্ত্ব", "14:03", false], ["যে চোকপয়েন্টগুলো বিশ্ব নিয়ন্ত্রণ করে", "11:40", false]] },
        { title: "আজকের শক্তি-জোটগুলো", lessons: [["ন্যাটো, ইইউ ও পশ্চিমা জোট", "16:22", false], ["বহুমেরু বিশ্বের উত্থান", "13:15", false]] },
        { title: "কেস স্টাডি", lessons: [["দক্ষিণ চীন সাগর: সহজ ব্যাখ্যা", "18:04", false], ["বাংলাদেশের অবস্থান", "15:30", false]] },
      ],
      includes: [
        { text: "৩ ঘণ্টা ২০ মিনিট অন-ডিমান্ড ভিডিও" },
        { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
        { text: "সম্পন্নতার সার্টিফিকেট" },
        { text: "বাংলা সাপোর্ট" },
        { text: "bKash-এ পেমেন্ট" },
      ],
      faqs: [
        { question: "রাজনীতি সম্পর্কে আগে থেকে জানা থাকা কি জরুরি?", answer: "না — এই কোর্সটি একদম শূন্য থেকে শুরু করে ধাপে ধাপে এগোয়, তাই এটিই যদি আপনার প্রথম ভূ-রাজনীতি চর্চা হয়, তাতেও কোনো সমস্যা নেই।" },
        { question: "কোর্সটিতে কতদিন অ্যাক্সেস থাকবে?", answer: "আজীবন অ্যাক্সেস। একবার ভর্তি হলে যেকোনো সময় যেকোনো লেসনে ফিরে আসতে পারবেন।" },
      ],
    },
    {
      id: "analyst-pro",
      courseType: "career_track",
      oldPrice: 1990,
      title: "পলিটিক্যাল অ্যানালিস্ট টুলকিট",
      price: 1490,
      free: false,
      duration: "8h 45m",
      rating: 4.8,
      students: 3800,
      tone: 4,
      category: "politics",
      desc: "বাস্তব সংবাদ দ্রুত বিশ্লেষণ করার ফ্রেমওয়ার্ক, সূত্র যাচাইয়ের পদ্ধতি ও লেখার কৌশল।",
      modules: [
        { title: "নিজের ফ্রেমওয়ার্ক তৈরি", lessons: [["চার-লেন্স বিশ্লেষণ মডেল", "20:11", true], ["পক্ষপাত চেনার অনুশীলন", "17:40", false]] },
        { title: "গবেষণা থেকে স্ক্রিপ্ট", lessons: [["প্রাথমিক সূত্র খুঁজে বের করা", "15:00", false], ["১০ মিনিটের এক্সপ্লেইনার সাজানো", "22:18", false], ["ডেডলাইনের ভেতর ফ্যাক্ট-চেক", "12:55", false]] },
      ],
      includes: [
        { text: "৮ ঘণ্টা ৪৫ মিনিট অন-ডিমান্ড ভিডিও" },
        { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
        { text: "সম্পন্নতার সার্টিফিকেট" },
        { text: "বাংলা সাপোর্ট" },
        { text: "bKash-এ পেমেন্ট" },
      ],
      faqs: [
        { question: "এই কোর্সটি কি শুধু লেখালেখি নিয়ে?", answer: "না — এতে বিশ্লেষণের ফ্রেমওয়ার্ক তৈরি ও সূত্র যাচাই করাও শেখানো হয়, শুধু লেখার প্রক্রিয়া নয়।" },
      ],
    },
    {
      id: "content-creator",
      oldPrice: 1290,
      title: "শিক্ষকদের জন্য কনটেন্ট তৈরি",
      price: 990,
      free: false,
      duration: "5h 10m",
      rating: 4.7,
      students: 6200,
      tone: 2,
      category: "skills",
      desc: "ক্যামেরা, স্ক্রিপ্ট, থাম্বনেইল ও গ্রোথ — শূন্য থেকে প্রথম ১,০০০ সাবস্ক্রাইবার পর্যন্ত একটি ব্যবহারিক পথ।",
      modules: [
        { title: "শুরু করা", lessons: [["কম বাজেটে গিয়ার", "9:30", true], ["কার্যকর হুক লেখা", "13:12", false]] },
        { title: "গ্রোথ", lessons: [["থাম্বনেইল ও টাইটেল", "11:45", false], ["ইউটিউব অ্যানালিটিকস পড়া", "16:02", false]] },
      ],
      includes: [
        { text: "৫ ঘণ্টা ১০ মিনিট অন-ডিমান্ড ভিডিও" },
        { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
        { text: "সম্পন্নতার সার্টিফিকেট" },
        { text: "বাংলা সাপোর্ট" },
        { text: "bKash-এ পেমেন্ট" },
      ],
      faqs: [
        { question: "শুরু করতে কি দামি সরঞ্জাম লাগবে?", answer: "না — কোর্সে আলাদা করে দেখানো হয়েছে কীভাবে হাতের কাছের সাধারণ গিয়ার দিয়েই শুরু করা যায়।" },
      ],
    },
    {
      id: "economy-explained",
      title: "বাংলাদেশের অর্থনীতি: সহজ ব্যাখ্যা",
      price: 1290,
      free: false,
      duration: "6h 00m",
      rating: 4.9,
      students: 2950,
      tone: 5,
      category: "economy",
      desc: "মূল্যস্ফীতি, রেমিট্যান্স, তৈরি পোশাক খাত ও মুদ্রানীতি — জটিল পরিভাষা ছাড়াই।",
      modules: [
        { title: "পুরো ছবিটা", lessons: [["টাকা কীভাবে চলে", "14:20", true], ["রেমিট্যান্স ও রিজার্ভ", "18:33", false]] },
        { title: "যে খাতগুলো গুরুত্বপূর্ণ", lessons: [["তৈরি পোশাক: অর্থনীতির মেরুদণ্ড", "19:10", false], ["ডিজিটাল অর্থনীতির উত্থান", "15:44", false]] },
      ],
      includes: [
        { text: "৬ ঘণ্টা অন-ডিমান্ড ভিডিও" },
        { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
        { text: "সম্পন্নতার সার্টিফিকেট" },
        { text: "বাংলা সাপোর্ট" },
        { text: "bKash-এ পেমেন্ট" },
      ],
      faqs: [
        { question: "অর্থনীতি বদলালে কি কোর্সটি হালনাগাদ করা হয়?", answer: "মূল ফ্রেমওয়ার্কগুলো দীর্ঘমেয়াদে প্রাসঙ্গিক থাকে; বড় কোনো হালনাগাদ হলে ভর্তি হওয়া শিক্ষার্থীদের জানিয়ে দেওয়া হয়।" },
      ],
    },
    {
      id: "exam-writing",
      courseType: "career_track",
      oldPrice: 2490,
      title: "লিখিত পরীক্ষা ও ভাইভা মাস্টারি (বিসিএস ট্র্যাক)",
      price: 1990,
      free: false,
      duration: "12h 30m",
      rating: 4.8,
      students: 9100,
      tone: 3,
      category: "exam",
      desc: "প্রতিযোগিতামূলক পরীক্ষার জন্য উত্তর সাজানো, সমসাময়িক বিষয়ের সমন্বয় ও ভাইভায় আত্মবিশ্বাস।",
      modules: [
        { title: "উত্তরের কাঠামো", lessons: [["তিন-অংশের উত্তর ফ্রেমওয়ার্ক", "17:00", true], ["পরীক্ষার হলে সময় ব্যবস্থাপনা", "10:20", false]] },
        { title: "ভাইভা প্রস্তুতি", lessons: [["ভাইভার পরিচিত ফাঁদ", "14:55", false], ["মক ভাইভা: সম্পূর্ণ অনুশীলন", "26:10", false]] },
      ],
      includes: [
        { text: "১২ ঘণ্টা ৩০ মিনিট অন-ডিমান্ড ভিডিও" },
        { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
        { text: "সম্পন্নতার সার্টিফিকেট" },
        { text: "বাংলা সাপোর্ট" },
        { text: "bKash-এ পেমেন্ট" },
      ],
      faqs: [
        { question: "লিখিত পরীক্ষার পাশাপাশি ভাইভাও কি এতে আছে?", answer: "হ্যাঁ — ভাইভা প্রস্তুতির জন্য আলাদা একটি মডিউল আছে, সেখানে সম্পূর্ণ একটি মক ভাইভাও রয়েছে।" },
      ],
    },
    {
      id: "career-roadmap",
      title: "আগামী দশকের ক্যারিয়ার রোডম্যাপ",
      price: 0,
      free: true,
      duration: "2h 40m",
      rating: 4.6,
      students: 15600,
      tone: 6,
      category: "skills",
      desc: "সবকিছু যখন বদলে যাচ্ছে তখন কীভাবে দিক ঠিক করবেন — বাড়তি কথা ছাড়া একটি ব্যবহারিক রোডম্যাপ।",
      modules: [
        { title: "আগে দিক ঠিক করুন", lessons: [["যে দক্ষতাগুলো পুরোনো হয় না", "11:00", true], ["পরবর্তী ৫ বছরের পরিকল্পনা", "13:45", false]] },
      ],
      includes: [
        { text: "২ ঘণ্টা ৪০ মিনিট অন-ডিমান্ড ভিডিও" },
        { text: "ডাউনলোডযোগ্য রিসোর্স ও নোট" },
        { text: "সম্পন্নতার সার্টিফিকেট" },
        { text: "বাংলা সাপোর্ট" },
      ],
      faqs: [
        { question: "কোর্সটি কি সত্যিই ফ্রি?", answer: "হ্যাঁ, সম্পূর্ণ ফ্রি — ভর্তি হতে কোনো পেমেন্ট বা কার্ডের তথ্য লাগবে না।" },
      ],
    },
  ],

  products: [
    { id: "book-politics-simplified", title: "রাজনীতি, সহজ ভাষায় — বইটি", type: "physical", price: 650, oldPrice: 800, tone: 1, category: "books", desc: "চ্যানেলের সঙ্গী বেস্টসেলিং বই — ভূ-রাজনীতি সহজ বাংলায় ব্যাখ্যা করা।" },
    { id: "notes-geo-pdf", title: "ভূ-রাজনীতি ক্র্যাশ কোর্স নোট (PDF)", type: "digital", price: 250, tone: 4, category: "notes", desc: "৪২ পৃষ্ঠার সংক্ষিপ্ত নোট — চ্যানেলে ব্যবহৃত প্রতিটি বড় ভূ-রাজনৈতিক ফ্রেমওয়ার্ক নিয়ে।" },
    { id: "tshirt-logo", title: "শাহেদীন লোগো টি-শার্ট", type: "physical", price: 590, tone: 2, category: "merch", desc: "ভারী সুতির টি-শার্ট, মিনিমাল ওয়ার্ডমার্ক প্রিন্ট। ইউনিসেক্স ফিট।" },
    { id: "guide-bcs-pdf", title: "বিসিএস লিখিত উত্তরের টেমপ্লেট (PDF)", type: "digital", price: 350, tone: 3, category: "notes", desc: "লিখিত পরীক্ষার সবচেয়ে পরিচিত প্রশ্নের ধরনগুলোর জন্য তৈরি, সহজে মানিয়ে নেওয়ার মতো উত্তর কাঠামো।" },
    { id: "mug-brand", title: "সিরামিক মগ — রাজনীতি, সহজ ভাষায়", type: "physical", price: 390, tone: 5, category: "merch", desc: "৩৫০ মিলি সিরামিক মগ, ডিশওয়াশার সেফ, সিগনেচার লাইন প্রিন্ট সহ।" },
    { id: "ebook-economy", title: "বাংলাদেশের অর্থনীতি এক্সপ্লেইনার (ইবুক)", type: "digital", price: 300, tone: 6, category: "notes", desc: "জাতীয় অর্থনীতি আসলে কীভাবে কাজ করে, সহজ ভাষায় তার পূর্ণ ব্যাখ্যা।" },
  ],

};
