/* =========================================================
   data.js — shared demo content used by data-driven pages
   (course catalog, store, dashboard). Replace with real API
   data later; the front-end logic already reads from here.
   ========================================================= */
window.SITE_DATA = {
  courses: [
    {
      id: "geo-101",
      title: "Geopolitics 101: Reading the World Map",
      price: 0,
      free: true,
      duration: "3h 20m",
      rating: 4.9,
      students: 12400,
      tone: 1,
      category: "politics",
      desc: "A foundational course on how global power actually moves — borders, resources, alliances.",
      modules: [
        { title: "Why Geography Still Rules Politics", lessons: [["Introduction & Course Map", "6:12", true], ["The Heartland Theory", "14:03", false], ["Chokepoints That Run the World", "11:40", false]] },
        { title: "Power Blocs Today", lessons: [["NATO, EU & the Western Bloc", "16:22", false], ["The Rise of Multipolarity", "13:15", false]] },
        { title: "Case Studies", lessons: [["South China Sea, Explained", "18:04", false], ["The Bangladesh Position", "15:30", false]] },
      ],
      includes: [
        { text: "3h 20m on-demand video" },
        { text: "Downloadable resources & notes" },
        { text: "Certificate of completion" },
        { text: "Bangla support" },
      ],
      faqs: [
        { question: "Do I need any prior knowledge of politics?", answer: "No — this course starts from zero and builds up gradually, so it's fine if this is your first time studying geopolitics." },
        { question: "How long do I have access to the course?", answer: "Lifetime access. Once you enroll, you can revisit any lesson whenever you like." },
      ],
    },
    {
      id: "analyst-pro",
      title: "The Political Analyst Toolkit",
      price: 1490,
      free: false,
      duration: "8h 45m",
      rating: 4.8,
      students: 3800,
      tone: 4,
      category: "politics",
      desc: "Frameworks, source-checking, and writing techniques used to break down real news, fast.",
      modules: [
        { title: "Building Your Framework", lessons: [["The 4-Lens Analysis Model", "20:11", true], ["Bias Detection Drills", "17:40", false]] },
        { title: "From Research to Script", lessons: [["Finding Primary Sources", "15:00", false], ["Structuring a 10-Minute Explainer", "22:18", false], ["Fact-Checking Under Deadline", "12:55", false]] },
      ],
      includes: [
        { text: "8h 45m on-demand video" },
        { text: "Downloadable resources & notes" },
        { text: "Certificate of completion" },
        { text: "Bangla support" },
      ],
      faqs: [
        { question: "Is this course only about writing?", answer: "No — it also covers building an analysis framework and source-checking, not just the writing process." },
      ],
    },
    {
      id: "content-creator",
      title: "Content Creation for Educators",
      price: 990,
      free: false,
      duration: "5h 10m",
      rating: 4.7,
      students: 6200,
      tone: 2,
      category: "skills",
      desc: "Camera, scripting, thumbnails and growth — a practical path from zero to your first 1,000 subscribers.",
      modules: [
        { title: "Getting Started", lessons: [["Gear on a Budget", "9:30", true], ["Writing Hooks That Work", "13:12", false]] },
        { title: "Growth", lessons: [["Thumbnails & Titles", "11:45", false], ["Reading YouTube Analytics", "16:02", false]] },
      ],
      includes: [
        { text: "5h 10m on-demand video" },
        { text: "Downloadable resources & notes" },
        { text: "Certificate of completion" },
        { text: "Bangla support" },
      ],
      faqs: [
        { question: "Do I need expensive equipment to start?", answer: "No — the course specifically covers how to start with budget-friendly gear you likely already own." },
      ],
    },
    {
      id: "economy-explained",
      title: "Bangladesh Economy, Explained",
      price: 1290,
      free: false,
      duration: "6h 00m",
      rating: 4.9,
      students: 2950,
      tone: 5,
      category: "economy",
      desc: "Inflation, remittance, RMG sector, and monetary policy — decoded without the jargon.",
      modules: [
        { title: "The Big Picture", lessons: [["How the Taka Moves", "14:20", true], ["Remittance & Reserves", "18:33", false]] },
        { title: "Sectors That Matter", lessons: [["The RMG Backbone", "19:10", false], ["Digital Economy Rising", "15:44", false]] },
      ],
      includes: [
        { text: "6h 00m on-demand video" },
        { text: "Downloadable resources & notes" },
        { text: "Certificate of completion" },
        { text: "Bangla support" },
      ],
      faqs: [
        { question: "Is this course updated as the economy changes?", answer: "The core frameworks stay relevant long-term; any major update notes are shared with enrolled students." },
      ],
    },
    {
      id: "exam-writing",
      title: "Written Exam & Viva Mastery (BCS Track)",
      price: 1990,
      free: false,
      duration: "12h 30m",
      rating: 4.8,
      students: 9100,
      tone: 3,
      category: "exam",
      desc: "Structuring answers, current affairs synthesis, and viva confidence for competitive exams.",
      modules: [
        { title: "Answer Architecture", lessons: [["The 3-Part Answer Framework", "17:00", true], ["Time Management in the Hall", "10:20", false]] },
        { title: "Viva Prep", lessons: [["Common Viva Traps", "14:55", false], ["Mock Viva Walkthrough", "26:10", false]] },
      ],
      includes: [
        { text: "12h 30m on-demand video" },
        { text: "Downloadable resources & notes" },
        { text: "Certificate of completion" },
        { text: "Bangla support" },
      ],
      faqs: [
        { question: "Does this cover viva as well as the written exam?", answer: "Yes — there's a dedicated module on viva prep, including a full mock viva walkthrough." },
      ],
    },
    {
      id: "career-roadmap",
      title: "Career Roadmap for the Next Decade",
      price: 0,
      free: true,
      duration: "2h 40m",
      rating: 4.6,
      students: 15600,
      tone: 6,
      category: "skills",
      desc: "How to pick a direction when everything is changing — a practical, no-fluff roadmap.",
      modules: [
        { title: "Direction First", lessons: [["Skills That Won't Expire", "11:00", true], ["Mapping Your Next 5 Years", "13:45", false]] },
      ],
      includes: [
        { text: "2h 40m on-demand video" },
        { text: "Downloadable resources & notes" },
        { text: "Certificate of completion" },
        { text: "Bangla support" },
      ],
      faqs: [
        { question: "Is this course really free?", answer: "Yes, completely free — no payment or card details needed to enroll." },
      ],
    },
  ],

  products: [
    { id: "book-politics-simplified", title: "Politics, Simplified — The Book", type: "physical", price: 650, oldPrice: 800, tone: 1, category: "books", desc: "The bestselling companion book to the channel — geopolitics explained in plain Bangla and English." },
    { id: "notes-geo-pdf", title: "Geopolitics Crash-Course Notes (PDF)", type: "digital", price: 250, tone: 4, category: "notes", desc: "42-page condensed notes covering every major geopolitical framework used in the channel." },
    { id: "tshirt-logo", title: "Shahedin Logo Tee", type: "physical", price: 590, tone: 2, category: "merch", desc: "Heavyweight cotton tee with the minimal wordmark. Unisex fit." },
    { id: "guide-bcs-pdf", title: "BCS Written Answer Templates (PDF)", type: "digital", price: 350, tone: 3, category: "notes", desc: "Ready-to-adapt answer structures for the most common written exam question types." },
    { id: "mug-brand", title: "Ceramic Mug — Politics, Simplified", type: "physical", price: 390, tone: 5, category: "merch", desc: "350ml ceramic mug, dishwasher safe, with the signature line print." },
    { id: "ebook-economy", title: "Bangladesh Economy Explainer (eBook)", type: "digital", price: 300, tone: 6, category: "notes", desc: "A plain-language walkthrough of how the national economy actually works." },
  ],

};
