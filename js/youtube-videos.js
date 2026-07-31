/* =========================================================
   youtube-videos.js — pulls the latest uploads from the
   channel's YouTube Data API v3 and renders them into the
   #videos "Featured Videos" section on the homepage.
   ========================================================= */
(function () {
  // 1) Put your own API key here (see console.cloud.google.com).
  const YT_API_KEY = "AIzaSyCXUYu2L4t2HVChhASx8_qvfkU8g80Ro-8";
  // Channel ID for @sorolkothok
  const CHANNEL_ID = "UCy_3itF8cSwKT00PWBKkTzA";
  const MAX_VIDEOS = 3;

  const mountEl = () => document.querySelector("[data-mount='featured-videos']");

  function formatViews(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function formatDuration(iso) {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const h = parseInt(m[1] || "0", 10);
    const min = parseInt(m[2] || "0", 10);
    const s = parseInt(m[3] || "0", 10);
    const parts = h ? [h, min, s] : [min, s];
    return parts.map((p, i) => (i === 0 ? p : String(p).padStart(2, "0"))).join(":");
  }

  function videoCardHTML(v) {
    return `
    <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener" class="card">
      <div class="thumb" style="background:#111;">
        <img src="${v.thumbnail}" alt="${v.title}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
        <div class="thumb-overlay"></div>
        <button class="play-btn" aria-label="Play video">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="thumb-badges"><span class="badge badge-dur" style="margin-left:auto;">${v.duration}</span></div>
      </div>
      <div class="card-body">
        <div class="card-title card-title-clamp">${v.title}</div>
        <div class="card-meta">${v.views} views</div>
      </div>
    </a>`;
  }

  async function fetchLatestVideos() {
    // Step 1: get the channel's "uploads" playlist ID
    const chRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}&key=${YT_API_KEY}`
    );
    const chData = await chRes.json();
    const uploadsPlaylistId =
      chData.items[0].contentDetails.relatedPlaylists.uploads;

    // Step 2: get the most recent videos from that playlist
    const plRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${MAX_VIDEOS}&key=${YT_API_KEY}`
    );
    const plData = await plRes.json();
    const videoIds = plData.items.map((it) => it.snippet.resourceId.videoId).join(",");

    // Step 3: get view counts + durations for those videos
    const vidRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${videoIds}&key=${YT_API_KEY}`
    );
    const vidData = await vidRes.json();
    const statsById = {};
    vidData.items.forEach((v) => {
      statsById[v.id] = v;
    });

    return plData.items.map((it) => {
      const id = it.snippet.resourceId.videoId;
      const stats = statsById[id];
      return {
        id,
        title: it.snippet.title,
        thumbnail:
          it.snippet.thumbnails.high?.url ||
          it.snippet.thumbnails.medium?.url ||
          it.snippet.thumbnails.default.url,
        views: stats ? formatViews(stats.statistics.viewCount) : "",
        duration: stats ? formatDuration(stats.contentDetails.duration) : "",
      };
    });
  }

  async function init() {
    const el = mountEl();
    if (!el) return;
    try {
      const videos = await fetchLatestVideos();
      el.innerHTML = videos.map(videoCardHTML).join("");
    } catch (err) {
      console.error("YouTube fetch failed:", err);
      el.innerHTML = `<p class="small-note">এই মুহূর্তে ভিডিও লোড করা যায়নি। <a href="https://www.youtube.com/@sorolkothok" target="_blank" rel="noopener">ইউটিউবে দেখুন →</a></p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();