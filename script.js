const videos = [
  {
    creator: "Jordan",
    username: "@jordan",
    caption: "This view is unreal! #travel",
    sound: "Original sound - Jordan",
    video: "https://videos.pexels.com/video-files/3129671/3129671-hd_1080_1920_25fps.mp4",
    poster: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=700",
    avatar: "https://i.pravatar.cc/100?img=12"
  },
  {
    creator: "Mia",
    username: "@mia",
    caption: "A little inspiration for your day ✨",
    sound: "Dreams - VYRO Sounds",
    video: "https://videos.pexels.com/video-files/3129595/3129595-hd_1080_1920_25fps.mp4",
    poster: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=700",
    avatar: "https://i.pravatar.cc/100?img=47"
  },
  {
    creator: "Alex",
    username: "@alex",
    caption: "Weekend adventures.",
    sound: "Original sound - Alex",
    video: "https://videos.pexels.com/video-files/854982/854982-hd_1080_1920_25fps.mp4",
    poster: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=700",
    avatar: "https://i.pravatar.cc/100?img=15"
  }
];

const videoFeed = document.getElementById("videoFeed");
const profileGrid = document.getElementById("profileGrid");
let soundOn = false; // feed starts muted so autoplay is allowed

// Escape text before putting it in innerHTML (prevents XSS once data is user-made)
function esc(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML.replace(/"/g, "&quot;");
}

// Play/pause videos as cards enter and leave view
const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      if (!video.getAttribute("src")) video.src = video.dataset.src;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
}, { threshold: 0.65 });

// Only start downloading a video when it is within one screen of view
const loadObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const v = entry.target;
    if (entry.isIntersecting && !v.getAttribute("src")) v.src = v.dataset.src;
  });
}, { rootMargin: "100% 0px" });

// One card builder for both sample videos and uploads
function createCard(data) {
  const card = document.createElement("article");
  card.className = "video-card";
  card.tabIndex = 0;
  if (data.id) card.dataset.id = data.id;
  if (data.ownerId) card.dataset.owner = data.ownerId;
  if (data.path) card.dataset.path = data.path;
  card.dataset.caption = data.caption || "";

  card.innerHTML = `
    <video class="feed-video" data-src="${esc(data.video)}" preload="none"
      ${data.poster ? `poster="${esc(data.poster)}"` : ""} loop playsinline></video>
    <div class="pause-icon" aria-hidden="true">▶</div>

    <div class="video-info">
      <strong>${esc(data.creator)} ${esc(data.username)}</strong>
      ${data.own ? "" : `<button class="follow-btn">${data.following ? "Following" : "Follow"}</button>`}
      <p>${esc(data.caption)}</p>
      <div class="sound-name">♪ ${esc(data.sound)}</div>
    </div>

    <div class="video-actions">
      <button class="video-action profile-action" aria-label="View ${esc(data.creator)}'s profile">
        <img src="${esc(data.avatar)}" alt="${esc(data.creator)}">
      </button>
      <button class="video-action like-action${data.liked ? " liked" : ""}" aria-label="Like">
        <span class="action-symbol">♥</span>
        <span class="like-count">${data.likes || 0}</span>
      </button>
      <button class="video-action comment-action">
        <span class="action-symbol">●</span>
        <span>Comment</span>
      </button>
      <button class="video-action repost-action">
        <span class="action-symbol">⟳</span>
        <span>Repost</span>
      </button>
      <button class="video-action share-action">
        <span class="action-symbol">↗</span>
        <span>Share</span>
      </button>
      <button class="video-action menu-action" aria-label="More options">
        <span class="action-symbol">•••</span>
        <span>More</span>
      </button>
      <button class="video-action sound-action" aria-label="Sound on or off">
        <span class="sound-disc">♪</span>
      </button>
    </div>

    <div class="video-menu">
      <button data-action="save">Save</button>
      <button data-action="speed">Speed</button>
      <button data-action="copy">Copy link</button>
      <button data-action="not-interested">Not interested</button>
${data.own ? '<button data-action="delete">Delete video</button>' : '<button data-action="report">Report</button>'}
    </div>
  `;

  const video = card.querySelector("video");
  video.muted = !soundOn;
  card.querySelector(".sound-action").classList.toggle("muted", !soundOn);
  videoObserver.observe(video);
  loadObserver.observe(video);
  return card;
}

// Demo videos show only until Supabase is configured (see config.js)
const vyroCfg = window.VYRO_CONFIG || {};
if (!(vyroCfg.url && vyroCfg.key && !vyroCfg.url.includes("YOUR-PROJECT"))) {
  videos.forEach(data => videoFeed.appendChild(createCard(data)));
}

function closeMenus() {
  document.querySelectorAll(".video-menu.open").forEach(menu => {
    menu.classList.remove("open");
  });
}

function setSound(on) {
  soundOn = on;
  document.querySelectorAll(".feed-video").forEach(video => {
    video.muted = !on;
  });
  document.querySelectorAll(".sound-action").forEach(btn => btn.classList.toggle("muted", !on));
}

function togglePlay(card) {
  const video = card.querySelector("video");
  if (!video.getAttribute("src")) video.src = video.dataset.src;
  if (video.paused) {
    video.play().catch(() => {});
    card.classList.remove("paused");
  } else {
    video.pause();
    card.classList.add("paused");
  }
}

// Keyboard: Enter or Space pauses / plays the focused video
videoFeed.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("video-card")) {
    event.preventDefault();
    togglePlay(event.target);
  }
});

// Video feed interactions
videoFeed.addEventListener("click", async event => {
  const card = event.target.closest(".video-card");
  if (!card) return;
  const video = card.querySelector("video");
  const button = event.target.closest("button");

  // Tap on the video itself: pause / play
  if (!button && !event.target.closest(".video-menu")) {
    if (card.querySelector(".video-menu.open")) {
      closeMenus();
      return;
    }
    togglePlay(card);
    return;
  }

  if (!button) return;

  if (button.classList.contains("profile-action")) {
    window.vyroBackend?.openUser(card.dataset.owner);
  }

  if (button.classList.contains("sound-action")) {
    setSound(!soundOn);
  }

  if (button.classList.contains("like-action")) {
    const liked = button.classList.toggle("liked");
    const countEl = button.querySelector(".like-count");
    countEl.textContent = Math.max(0, Number(countEl.textContent) + (liked ? 1 : -1));
    window.vyroBackend?.setLike(card.dataset.id, liked, button);
  }

  if (button.classList.contains("follow-btn")) {
    button.textContent =
      button.textContent === "Follow" ? "Following" : "Follow";
    const nowFollowing = button.textContent === "Following";
    document.querySelectorAll(".video-card").forEach(c => {
      const b = c.querySelector(".follow-btn");
      if (b && c.dataset.owner && c.dataset.owner === card.dataset.owner) {
        b.textContent = nowFollowing ? "Following" : "Follow";
      }
    });
    window.vyroBackend?.setFollow(card.dataset.owner, nowFollowing);
  }

  if (button.classList.contains("comment-action")) {
    if (window.vyroBackend) {
      alert("Comments are coming soon to VYRO.");
    } else {
      const comment = prompt("Write a comment:");
      if (comment) alert("Comment added: " + comment);
    }
  }

  if (button.classList.contains("repost-action")) {
    alert(window.vyroBackend ? "Reposts are coming soon to VYRO." : "Video reposted!");
  }

  if (button.classList.contains("share-action")) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "VYRO video",
          text: "Check out this video on VYRO!",
          url: location.href.split("#")[0]
        });
      } catch (error) {}
    } else {
      alert("Share this video with your friends!");
    }
  }

  if (button.classList.contains("menu-action")) {
    const menu = card.querySelector(".video-menu");
    const wasOpen = menu.classList.contains("open");
    closeMenus();
    menu.classList.toggle("open", !wasOpen);
  }

  if (button.dataset.action) {
    const action = button.dataset.action;

    if (action === "delete") {
      closeMenus();
      if (confirm("Delete this video for good?")) {
        const ok = window.vyroBackend
          ? await window.vyroBackend.deleteVideo(card.dataset.id, card.dataset.path)
          : true;
        if (ok) {
          videoObserver.unobserve(video);
          video.pause();
          card.remove();
        }
      }
      return;
    }

    if (action === "save") alert(window.vyroBackend ? "Saving videos is coming soon." : "Video saved!");

    if (action === "speed") {
      const speeds = [1, 1.5, 2, 0.5];
      const next = speeds[(speeds.indexOf(video.playbackRate) + 1) % speeds.length];
      video.playbackRate = next;
      button.textContent = "Speed: " + next + "x";
      return;
    }

    if (action === "copy") {
      const link = location.href.split("#")[0];
      try {
        await navigator.clipboard.writeText(link);
        alert("Link copied!");
      } catch (error) {
        alert(link);
      }
    }

    if (action === "not-interested") {
      window.vyroBackend?.notInterested(card.dataset.id, card.dataset.owner, card.dataset.caption);
      videoObserver.unobserve(video);
      video.pause();
      card.remove();
      return;
    }

    if (action === "report") {
      if (window.vyroBackend) window.vyroBackend.report(card.dataset.id);
      else alert("Thanks. Your report has been noted in this demo.");
    }

    closeMenus();
  }
});

// Close the "More" menu when tapping anywhere outside it
document.addEventListener("click", event => {
  if (!event.target.closest(".video-menu") &&
      !event.target.closest(".menu-action")) {
    closeMenus();
  }
});

// Navigation (every element with data-page: nav buttons, Back, Cancel)
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.page === pageId);
  });

  closeMenus();
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  showPage("settings");
});

// Explore sample creators and photos
const creators = [
  ["Mia", 47],
  ["Jordan", 12],
  ["Alex", 15],
  ["Sam", 22],
  ["Taylor", 32]
];

document.getElementById("creatorList").innerHTML = creators.map(([name, id]) => `
  <div class="creator">
    <img src="https://i.pravatar.cc/100?img=${id}" alt="${esc(name)}">
    <p>${esc(name)}</p>
  </div>
`).join("");

const photos = [
  "photo-1470252649378-9c29740c9fa8",
  "photo-1500530855697-b586d89ba3ee",
  "photo-1501785888041-af3ef285b470",
  "photo-1518837695005-2083093ee35b",
  "photo-1470770841072-f978cf4d019e",
  "photo-1493246507139-91e8fad9978e"
];

document.getElementById("trendGrid").innerHTML = photos.map(photo => `
  <img src="https://images.unsplash.com/${photo}?w=400" alt="Trending photo">
`).join("");

// Notifications
document.getElementById("notifications").innerHTML = `
  <div class="message">
    <img src="https://i.pravatar.cc/100?img=47" alt="Mia">
    <div><strong>Mia</strong><p>Started following you</p></div>
  </div>
  <div class="message">
    <img src="https://i.pravatar.cc/100?img=15" alt="Alex">
    <div><strong>Alex</strong><p>Liked your video</p></div>
  </div>
`;

// Profile (saved in localStorage so edits survive a refresh)
const PROFILE_KEY = "vyro-profile";
const profile = { name: "VYRO User", username: "user0", bio: "Welcome to my VYRO profile." };

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (saved && saved.username) Object.assign(profile, saved);
  } catch (error) {}
}

function saveProfile() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {}
}

function renderProfile() {
  document.getElementById("displayName").textContent = profile.name;
  document.getElementById("username").textContent = "@" + profile.username;
  document.getElementById("bio").textContent = profile.bio;
}

loadProfile();
renderProfile();

// Your Videos grid (empty message until something is uploaded)
function renderEmptyProfileGrid() {
  if (!profileGrid.children.length) {
    profileGrid.innerHTML =
      '<p class="empty-note">No videos yet. Tap Create to upload your first one.</p>';
  }
}
renderEmptyProfileGrid();

// Create: upload a video
const videoInput = document.getElementById("videoInput");

document.getElementById("uploadBtn").addEventListener("click", () => {
  videoInput.click();
});

videoInput.addEventListener("change", () => {
  const file = videoInput.files[0];
  if (!file) return;

  if (window.vyroBackend) {
    window.vyroBackend.upload(file);
    videoInput.value = "";
    return;
  }

  const url = URL.createObjectURL(file);
  const card = createCard({
    own: true,
    creator: profile.name,
    username: "@" + profile.username,
    caption: "New VYRO upload",
    sound: "Original sound - " + profile.name,
    video: url,
    poster: "",
    avatar: "https://i.pravatar.cc/150?img=32"
  });

  videoFeed.prepend(card);
  showPage("home");
  videoFeed.scrollTop = 0;
  card.scrollIntoView();

  // Add to "Your Videos" on the profile
  const empty = profileGrid.querySelector(".empty-note");
  if (empty) empty.remove();
  const thumb = document.createElement("video");
  thumb.src = url;
  thumb.muted = true;
  thumb.playsInline = true;
  thumb.preload = "metadata";
  profileGrid.prepend(thumb);

  videoInput.value = ""; // allow picking the same file again
});

document.getElementById("liveBtn").addEventListener("click", () => {
  alert("Live streaming needs a live-video service and server setup.");
});

// Profile editing
document.getElementById("editProfileBtn").addEventListener("click", () => {
  document.getElementById("nameInput").value = profile.name;
  document.getElementById("usernameInput").value = profile.username;
  document.getElementById("bioInput").value = profile.bio;
  showPage("editProfile");
});

document.getElementById("saveProfileBtn").addEventListener("click", () => {
  const name = document.getElementById("nameInput").value.trim();
  const username = document.getElementById("usernameInput").value.trim()
    .toLowerCase().replace(/[^a-z0-9_]/g, "");
  const bio = document.getElementById("bioInput").value.trim();

  if (!username) {
    alert("Please enter a username.");
    return;
  }

  profile.name = name || "VYRO User";
  profile.username = username;
  profile.bio = bio;
  saveProfile();
  renderProfile();
  window.vyroBackend?.saveProfile(profile);
  showPage("profile");
});
