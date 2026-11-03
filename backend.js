// VYRO backend (Supabase). Runs after script.js and reuses its createCard, showPage, profile, etc.
(function () {
  const body = document.body;
  const cfg = window.VYRO_CONFIG || {};
  const configured = cfg.url && cfg.key && !cfg.url.includes("YOUR-PROJECT") && window.supabase;

  // Not set up yet: stay in demo mode
  if (!configured) {
    body.classList.remove("booting", "logged-out");
    showPage("home");
    if (cfg.url && !cfg.url.includes("YOUR-PROJECT") && !window.supabase) {
      window.vyroBanner?.("The Supabase library did not load, so VYRO is in demo mode. Check your internet or turn off ad blockers for this site.");
    }
    return;
  }

  const sb = window.supabase.createClient(cfg.url, cfg.key);
  body.classList.add("live");
  const $ = id => document.getElementById(id) || document.createElement("div");
  const MAX_MB = 50;
  const TYPES = ["video/mp4", "video/webm", "video/quicktime"];
  const FEED_SELECT =
    "id,user_id,video_path,caption,created_at,likes(count)";
  let me = null;
  let feedMode = "foryou";
  let blocked = new Set();
  let feedPage = 0;
  let feedDone = false;
  let feedLoading = false;
  let lastPage = "home";
  const PAGE = 20;
  let seen = new Set();
  let likedCreators = new Map();
  let likedTags = new Map();
  let dislikedCreators = new Map();
  let dislikedTags = new Map();
  let notInterestedIds = new Set();

  const urlFor = path => sb.storage.from("videos").getPublicUrl(path).data.publicUrl;
  const detail = err => {
    if (!err) return "";
    let m = err.message || String(err);
    try { m = JSON.parse(m).message || m; } catch (e) {}
    return "\n\nDetails: " + m;
  };
  const fail = (message, err) => { console.error(err); alert(message + detail(err)); };
  const safe = (label, fn) => fn().catch(err => {
    console.error(err);
    window.vyroBanner?.(label + " failed: " + (err.message || err));
  });
  const notBlocked = (q, col) =>
    blocked.size ? q.not(col, "in", "(" + [...blocked].join(",") + ")") : q;

  function thumb(url) {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    return v;
  }

  function toCard(row, liked, following) {
    const p = row.profiles || {};
    const name = p.display_name || p.username || "user";
    return createCard({
      id: row.id,
      path: row.video_path,
      ownerId: row.user_id,
      own: row.user_id === me.id,
      creator: name,
      username: "@" + (p.username || "user"),
      caption: row.caption,
      sound: "Original sound - " + name,
      video: urlFor(row.video_path),
      poster: "",
      avatar: "https://i.pravatar.cc/100?u=" + row.user_id,
      likes: row.likes?.[0]?.count || 0,
      liked: liked.has(row.id),
      following: following.has(row.user_id)
    });
  }

  function clearFeed() {
    videoFeed.querySelectorAll("video").forEach(v => {
      videoObserver.unobserve(v);
      v.pause();
    });
    videoFeed.innerHTML = "";
  }

  // Look up creators separately so there is no video-to-profile link to get confused about
  async function attachProfiles(rows) {
    const ids = [...new Set(rows.map(r => r.user_id))];
    if (!ids.length) return;
    const { data } = await sb.from("profiles").select("id,username,display_name").in("id", ids);
    const byId = new Map((data || []).map(p => [p.id, p]));
    rows.forEach(r => { r.profiles = byId.get(r.user_id) || null; });
  }

  function showFeedMessage(text) {
    videoFeed.innerHTML = '<p class="feed-empty"></p>';
    videoFeed.firstChild.textContent = text;
  }

  // Load the next page when the last card is on screen
  const moreObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        moreObserver.unobserve(e.target);
        loadFeed(false);
      }
    });
  }, { threshold: 0.5 });

  async function loadFeed(reset = true) {
    if (feedLoading || (!reset && feedDone)) return;
    feedLoading = true;
    try {
      if (reset) { feedPage = 0; feedDone = false; seen = new Set(); }
      let query = notBlocked(sb.from("videos").select(FEED_SELECT), "user_id");

      if (feedMode === "following") {
        const f = await sb.from("follows").select("following_id").eq("follower_id", me.id);
        const followed = (f.data || []).map(r => r.following_id).filter(id => !blocked.has(id));
        if (!followed.length) {
          feedDone = true;
          if (reset) { clearFeed(); showFeedMessage("Follow creators to see their videos here."); }
          return;
        }
        query = query.in("user_id", followed);
      }

      const from = feedPage * PAGE;
      const { data, error } = await query
        .order("created_at", { ascending: false }).range(from, from + PAGE - 1);
      if (error) {
        if (reset) showFeedMessage("Couldn't load videos. Reload the page to try again.");
        return fail("Couldn't load the feed.", error);
      }

      let rows = data;
      if (feedMode === "foryou") {
        if (reset) rows = rows.concat(await favouriteCreatorVideos());
        rows = rankRows(rows);
      }
      rows = rows.filter(r => !seen.has(r.id) && !notInterestedIds.has(r.id));
      rows.forEach(r => seen.add(r.id));
      await attachProfiles(rows);

      const ids = rows.map(v => v.id);
      const owners = [...new Set(rows.map(v => v.user_id))];
      const [lk, fl] = await Promise.all([
        ids.length ? sb.from("likes").select("video_id").eq("user_id", me.id).in("video_id", ids) : { data: [] },
        owners.length ? sb.from("follows").select("following_id").eq("follower_id", me.id).in("following_id", owners) : { data: [] }
      ]);
      const liked = new Set((lk.data || []).map(r => r.video_id));
      const following = new Set((fl.data || []).map(r => r.following_id));

      if (reset) clearFeed();
      feedPage++;
      if (data.length < PAGE) feedDone = true;
      if (!rows.length && !feedDone) {
        feedLoading = false;
        return loadFeed(false);
      }
      if (!rows.length) {
        if (reset) {
          showFeedMessage(feedMode === "following"
            ? "The creators you follow haven't posted yet."
            : "No videos yet. Tap Create to post the first one.");
        }
        return;
      }
      const cards = rows.map(row => toCard(row, liked, following));
      cards.forEach(c => videoFeed.appendChild(c));
      if (!feedDone) moreObserver.observe(cards[cards.length - 1]);
    } finally {
      feedLoading = false;
    }
  }

  async function loadProfile() {
    const { data: p } = await sb.from("profiles").select("*").eq("id", me.id).single();
    if (p) {
      Object.assign(profile, { name: p.display_name, username: p.username, bio: p.bio });
      renderProfile();
    }

    const [mine, fing, fers] = await Promise.all([
      sb.from("videos").select("id,video_path,likes(count)").eq("user_id", me.id)
        .order("created_at", { ascending: false }),
      sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", me.id),
      sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", me.id)
    ]);

    const vids = mine.data || [];
    profileGrid.innerHTML = "";
    vids.forEach(v => profileGrid.appendChild(thumb(urlFor(v.video_path))));
    renderEmptyProfileGrid();

    const nums = document.querySelectorAll("#profile .stats strong");
    nums[0].textContent = fing.count || 0;
    nums[1].textContent = fers.count || 0;
    nums[2].textContent = vids.reduce((sum, v) => sum + (v.likes?.[0]?.count || 0), 0);
  }

  async function upload(file) {
    if (!TYPES.includes(file.type)) {
      alert("Please choose an MP4, WebM or MOV video.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      alert("That video is over " + MAX_MB + " MB. Choose a smaller one.");
      return;
    }
    const caption = $("captionInput").value.trim().slice(0, 150);
    const btn = $("uploadBtn");
    btn.disabled = true;
    btn.textContent = "Uploading…";

    try {
      const ext = file.type === "video/webm" ? "webm" : file.type === "video/quicktime" ? "mov" : "mp4";
      const path = `${me.id}/${Date.now()}.${ext}`;
      const up = await sb.storage.from("videos")
        .upload(path, file, { contentType: file.type, cacheControl: "3600" });
      if (up.error) throw up.error;

      const ins = await sb.from("videos")
        .insert({ user_id: me.id, video_path: path, caption })
        .select(FEED_SELECT).single();
      if (ins.error) {
        await sb.storage.from("videos").remove([path]);
        throw ins.error;
      }

      $("captionInput").value = "";
      profileGrid.querySelector(".empty-note")?.remove();
      profileGrid.prepend(thumb(urlFor(path)));
      setFeedTab("foryou");
      showPage("home");
      await loadFeed(true);
      videoFeed.scrollTop = 0;
    } catch (err) {
      fail("Upload failed. Check your connection and try again.", err);
    } finally {
      btn.disabled = false;
      btn.textContent = "Upload Video";
    }
  }

  async function setLike(videoId, liked, button) {
    if (!videoId) return;
    const { error } = liked
      ? await sb.from("likes").insert({ user_id: me.id, video_id: videoId })
      : await sb.from("likes").delete().eq("user_id", me.id).eq("video_id", videoId);
    if (error) {
      if (button) {
        button.classList.toggle("liked", !liked);
        const c = button.querySelector(".like-count");
        c.textContent = Math.max(0, Number(c.textContent) + (liked ? -1 : 1));
      }
      fail("Couldn't save that like. Try again.", error);
    } else if (button) {
      const c = button.closest(".video-card");
      if (c) learn(likedCreators, likedTags, c.dataset.owner, c.dataset.caption, liked ? 1 : -1);
    }
  }

  async function setFollow(ownerId, follow) {
    if (!ownerId) return;
    const { error } = follow
      ? await sb.from("follows").insert({ follower_id: me.id, following_id: ownerId })
      : await sb.from("follows").delete().eq("follower_id", me.id).eq("following_id", ownerId);
    if (error) {
      syncFollow(ownerId, !follow);
      fail("Couldn't save that follow. Try again.", error);
    }
  }

  async function saveProfile(p) {
    const { error } = await sb.from("profiles")
      .update({ username: p.username, display_name: p.name, bio: p.bio.slice(0, 200) })
      .eq("id", me.id);
    if (error) {
      alert(error.code === "23505" ? "That username is taken. Pick another." : "Couldn't save your profile.");
      console.error(error);
      loadProfile();
    }
  }

  async function report(videoId) {
    if (!videoId) return;
    const reason = (prompt("Why are you reporting this video? (spam, nudity, violence, harassment, other)", "other") || "")
      .trim().slice(0, 100);
    if (!reason) return;
    const { error } = await sb.from("reports")
      .insert({ reporter_id: me.id, video_id: videoId, reason });
    if (error && error.code === "23505") return alert("You already reported this video. Thanks.");
    if (error) return fail("Couldn't send your report. Try again.", error);
    alert("Thanks. Your report was sent for review.");
  }

  async function deleteVideo(id, path) {
    if (!id) return false;
    const { data, error } = await sb.from("videos").delete().eq("id", id).select("id");
    if (error || !data.length) {
      fail("Couldn't delete that video.", error || "no rows deleted");
      return false;
    }
    if (path) await sb.storage.from("videos").remove([path]);
    loadProfile();
    loadExplore();
    return true;
  }

  // Explore: real creators and newest videos, plus username search
  function renderCreators(list) {
    $("creatorList").innerHTML = list.length
      ? list.map(p => `<div class="creator" data-id="${esc(p.id)}" role="button" tabindex="0"><img src="https://i.pravatar.cc/100?u=${esc(p.id)}" alt=""><p>${esc(p.display_name || p.username)}</p></div>`).join("")
      : '<p class="empty-note">No creators found.</p>';
  }

  async function loadExplore() {
    const [c, v] = await Promise.all([
      notBlocked(sb.from("profiles").select("id,username,display_name"), "id").order("created_at", { ascending: false }).limit(20),
      notBlocked(sb.from("videos").select("id,video_path"), "user_id").order("created_at", { ascending: false }).limit(12)
    ]);
    renderCreators(c.data || []);
    const grid = $("trendGrid");
    grid.innerHTML = "";
    (v.data || []).forEach(r => grid.appendChild(thumb(urlFor(r.video_path))));
    if (!grid.children.length) grid.innerHTML = '<p class="empty-note">No videos yet.</p>';
  }

  let searchTimer;
  $("searchInput").addEventListener("input", event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = event.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      let query = notBlocked(sb.from("profiles").select("id,username,display_name"), "id").limit(20);
      query = q ? query.ilike("username", q + "%") : query.order("created_at", { ascending: false });
      const { data } = await query;
      renderCreators(data || []);
    }, 300);
  });

  // Social: real follows and likes on your videos
  async function loadNotifications() {
    const [f, l] = await Promise.all([
      sb.from("follows").select("follower_id,created_at,profiles!follows_follower_id_fkey(username)")
        .eq("following_id", me.id).order("created_at", { ascending: false }).limit(20),
      sb.from("likes").select("user_id,created_at,profiles!likes_user_id_fkey(username),videos!inner(user_id)")
        .eq("videos.user_id", me.id).neq("user_id", me.id)
        .order("created_at", { ascending: false }).limit(20)
    ]);
    const items = [
      ...(f.data || []).map(r => ({ id: r.follower_id, name: r.profiles?.username, text: "started following you", at: r.created_at })),
      ...(l.data || []).map(r => ({ id: r.user_id, name: r.profiles?.username, text: "liked your video", at: r.created_at }))
    ].filter(i => !blocked.has(i.id)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
    updateBadge(items);

    $("notifications").innerHTML = items.length
      ? items.map(i => `<div class="message"><img src="https://i.pravatar.cc/100?u=${esc(i.id)}" alt=""><div><strong>${esc(i.name || "Someone")}</strong><p>${i.text}</p></div></div>`).join("")
      : '<p class="empty-note">No activity yet.</p>';
  }

  // For You / Following tabs
  const feedTabs = document.querySelectorAll(".feed-tabs span");
  function setFeedTab(mode) {
    feedMode = mode;
    feedTabs.forEach(t => t.classList.toggle("selected", t.dataset.feed === mode));
  }
  feedTabs.forEach(tab => tab.addEventListener("click", () => {
    if (!me || tab.dataset.feed === feedMode) return;
    setFeedTab(tab.dataset.feed);
    loadFeed();
  }));

  // ---- Blocking ----
  async function loadBlocked() {
    const { data } = await sb.from("blocks").select("blocked_id").eq("blocker_id", me.id);
    blocked = new Set((data || []).map(r => r.blocked_id));
  }

  async function setBlock(id, block) {
    const { error } = block
      ? await sb.from("blocks").insert({ blocker_id: me.id, blocked_id: id })
      : await sb.from("blocks").delete().eq("blocker_id", me.id).eq("blocked_id", id);
    if (error && error.code !== "23505") {
      fail("Couldn't update the block. Try again.", error);
      return false;
    }
    if (block) {
      blocked.add(id);
      await sb.from("follows").delete().eq("follower_id", me.id).eq("following_id", id);
    } else {
      blocked.delete(id);
    }
    await Promise.all([loadFeed(), loadExplore(), loadNotifications()]);
    return true;
  }

  async function renderBlocked() {
    const { data } = await sb.from("blocks")
      .select("blocked_id,profiles!blocks_blocked_id_fkey(username)").eq("blocker_id", me.id);
    $("blockedList").innerHTML = (data || []).length
      ? data.map(r => `<div class="message"><div class="grow"><strong>@${esc(r.profiles?.username || "user")}</strong></div><button class="secondary-btn unblock" data-id="${esc(r.blocked_id)}">Unblock</button></div>`).join("")
      : '<p class="empty-note">You have not blocked anyone.</p>';
  }

  $("blockedBtn").addEventListener("click", renderBlocked);
  $("blockedList").addEventListener("click", async event => {
    const btn = event.target.closest(".unblock");
    if (btn && await setBlock(btn.dataset.id, false)) renderBlocked();
  });

  // ---- Other people's profiles ----
  let viewing = null;

  function renderUpButtons() {
    $("upFollow").textContent = viewing.following ? "Following" : "Follow";
  }

  function syncFollow(ownerId, following) {
    document.querySelectorAll(".video-card").forEach(c => {
      const b = c.querySelector(".follow-btn");
      if (b && c.dataset.owner === ownerId) b.textContent = following ? "Following" : "Follow";
    });
    if (viewing && viewing.id === ownerId) {
      viewing.following = following;
      renderUpButtons();
    }
  }

  async function openUser(id) {
    if (!id) return;
    if (id === me.id) { showPage("profile"); return; }
    lastPage = document.querySelector(".page.active")?.id || "home";
    const [p, vids, fing, fers, isF] = await Promise.all([
      sb.from("profiles").select("id,username,display_name,bio").eq("id", id).maybeSingle(),
      sb.from("videos").select("id,video_path").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
      sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", id),
      sb.from("follows").select("*", { count: "exact", head: true }).eq("following_id", id),
      sb.from("follows").select("follower_id").eq("follower_id", me.id).eq("following_id", id).maybeSingle()
    ]);
    if (!p.data) { alert("That profile couldn't be found."); return; }
    viewing = { id, following: !!isF.data };
    $("upAvatar").src = "https://i.pravatar.cc/150?u=" + id;
    $("upName").textContent = p.data.display_name || p.data.username;
    $("upUsername").textContent = "@" + p.data.username;
    $("upBio").textContent = p.data.bio || "";
    const list = vids.data || [];
    const nums = document.querySelectorAll("#upStats strong");
    nums[0].textContent = fing.count || 0;
    nums[1].textContent = fers.count || 0;
    nums[2].textContent = list.length;
    const grid = $("upGrid");
    grid.innerHTML = "";
    list.forEach(v => grid.appendChild(thumb(urlFor(v.video_path))));
    if (!list.length) grid.innerHTML = '<p class="empty-note">No videos yet.</p>';
    renderUpButtons();
    showPage("userProfile");
  }

  $("upFollow").addEventListener("click", async () => {
    viewing.following = !viewing.following;
    syncFollow(viewing.id, viewing.following);
    await setFollow(viewing.id, viewing.following);
  });
  $("upBlock").addEventListener("click", async () => {
    if (!confirm("Block this account? You won't see their videos.")) return;
    if (await setBlock(viewing.id, true)) { alert("Blocked."); showPage("home"); }
  });
  $("upBack").addEventListener("click", () => showPage(lastPage === "userProfile" ? "home" : lastPage));

  $("creatorList").addEventListener("click", event => {
    const c = event.target.closest(".creator");
    if (c) openUser(c.dataset.id);
  });
  $("creatorList").addEventListener("keydown", event => {
    const c = event.target.closest(".creator");
    if (c && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openUser(c.dataset.id); }
  });

  // ---- Settings ----
  $("accountBtn").addEventListener("click", () => alert("Signed in as " + me.email));
  $("privacyBtn").addEventListener("click", () => window.open("terms.html", "_blank", "noopener"));
  $("helpBtn").addEventListener("click", () => {
    location.href = "mailto:" + (cfg.supportEmail || "") + "?subject=VYRO%20support";
  });

  $("deleteAccountBtn").addEventListener("click", async () => {
    const typed = prompt("This permanently deletes your account, videos, likes and follows. Type DELETE to confirm.");
    if (typed !== "DELETE") return;
    try {
      const { data } = await sb.from("videos").select("video_path").eq("user_id", me.id);
      const paths = (data || []).map(v => v.video_path);
      if (paths.length) await sb.storage.from("videos").remove(paths);
      const { error } = await sb.rpc("delete_my_account");
      if (error) throw error;
      await sb.auth.signOut();
      alert("Your account has been deleted.");
    } catch (err) {
      fail("Couldn't delete your account. Please email support.", err);
    }
  });

  // ---- Unread badge, refresh and polling ----
  const seenKey = () => "vyro-seen-" + me.id;
  function lastSeen() {
    try { return Number(localStorage.getItem(seenKey())) || 0; } catch (e) { return 0; }
  }
  function markSeen() {
    try { localStorage.setItem(seenKey(), String(Date.now())); } catch (e) {}
    $("socialBadge").hidden = true;
  }
  function updateBadge(items) {
    const n = items.filter(i => new Date(i.at).getTime() > lastSeen()).length;
    $("socialBadge").textContent = n > 9 ? "9+" : n;
    $("socialBadge").hidden = n === 0;
  }

  (document.querySelector('.nav-item[data-page="social"]') || document.createElement("div")).addEventListener("click", async () => {
    await loadNotifications();
    markSeen();
  });
  (document.querySelector('.nav-item[data-page="explore"]') || document.createElement("div")).addEventListener("click", () => loadExplore());
  setInterval(async () => {
    if (!me || document.hidden) return;
    await loadNotifications();
    if ($("social").classList.contains("active")) markSeen();
  }, 60000);

  async function ensureProfile() {
    const { data } = await sb.from("profiles").select("id").eq("id", me.id).maybeSingle();
    if (data) return;
    const name = (me.user_metadata?.username || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24)
      || "user" + me.id.replace(/-/g, "").slice(0, 8);
    const { error } = await sb.from("profiles").insert({ id: me.id, username: name, display_name: name });
    if (error) console.error(error);
  }

  // ---- Feed learns from your likes and "Not interested" ----
  function tagsOf(text) {
    return String(text || "").toLowerCase().match(/#[a-z0-9_]+/g) || [];
  }
  function bump(map, key, delta) {
    map.set(key, Math.max(0, (map.get(key) || 0) + delta));
  }
  function learn(creators, tags, owner, caption, delta) {
    if (owner) bump(creators, owner, delta);
    tagsOf(caption).forEach(t => bump(tags, t, delta));
  }

  async function loadTaste() {
    const [l, n] = await Promise.all([
      sb.from("likes").select("videos(user_id,caption)").eq("user_id", me.id).limit(200),
      sb.from("not_interested").select("video_id,videos(user_id,caption)").eq("user_id", me.id).limit(200)
    ]);
    likedCreators = new Map();
    likedTags = new Map();
    dislikedCreators = new Map();
    dislikedTags = new Map();
    notInterestedIds = new Set();
    (l.data || []).forEach(r => {
      if (r.videos) learn(likedCreators, likedTags, r.videos.user_id, r.videos.caption, 1);
    });
    (n.data || []).forEach(r => {
      notInterestedIds.add(r.video_id);
      if (r.videos) learn(dislikedCreators, dislikedTags, r.videos.user_id, r.videos.caption, 1);
    });
  }

  function score(row, index, total) {
    let s = 3 * Math.min(likedCreators.get(row.user_id) || 0, 3)
          - 5 * Math.min(dislikedCreators.get(row.user_id) || 0, 3);
    tagsOf(row.caption).forEach(t => {
      s += Math.min(likedTags.get(t) || 0, 3) - 2 * Math.min(dislikedTags.get(t) || 0, 3);
    });
    return s + (total - index) / total;
  }

  function rankRows(rows) {
    const ids = new Set();
    const unique = rows.filter(r => !ids.has(r.id) && ids.add(r.id));
    return unique
      .map((r, i) => ({ r, s: score(r, i, unique.length) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.r);
  }

  async function favouriteCreatorVideos() {
    const top = [...likedCreators.entries()]
      .filter(([id, n]) => n > 0 && !blocked.has(id))
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
    if (!top.length) return [];
    const { data } = await notBlocked(sb.from("videos").select(FEED_SELECT), "user_id")
      .in("user_id", top).order("created_at", { ascending: false }).limit(10);
    return data || [];
  }

  async function notInterested(videoId, ownerId, caption) {
    if (!videoId) return;
    notInterestedIds.add(videoId);
    learn(dislikedCreators, dislikedTags, ownerId, caption, 1);
    const { error } = await sb.from("not_interested").insert({ user_id: me.id, video_id: videoId });
    if (error && error.code !== "23505") console.error(error);
  }

  window.vyroBackend = { upload, setLike, setFollow, saveProfile, report, deleteVideo, openUser, notInterested };

  // Login / sign-up form
  let signingUp = false;

  function setMode(isSignUp) {
    signingUp = isSignUp;
    $("authTitle").textContent = isSignUp ? "Create your VYRO account" : "Log in to VYRO";
    $("authUsernameWrap").hidden = !isSignUp;
    $("authUsername").required = isSignUp;
    $("authSubmit").textContent = isSignUp ? "Sign up" : "Log in";
    $("authToggle").textContent = isSignUp ? "I already have an account" : "Create an account";
    $("authPassword").autocomplete = isSignUp ? "new-password" : "current-password";
    $("authForgot").hidden = isSignUp;
    $("authTermsWrap").hidden = !isSignUp;
    $("authTerms").required = isSignUp;
    $("authMsg").textContent = "";
  }

  $("authToggle").addEventListener("click", () => setMode(!signingUp));

  $("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const msg = $("authMsg");
    const btn = $("authSubmit");
    msg.textContent = "";
    btn.disabled = true;

    try {
      if (signingUp) {
        const username = $("authUsername").value.trim().toLowerCase()
          .replace(/[^a-z0-9_]/g, "").slice(0, 24);
        if (!username) {
          msg.textContent = "Choose a username with letters, numbers or underscores.";
          return;
        }
        if (!$("authTerms").checked) {
          msg.textContent = "Please confirm you're 13 or older and agree to the terms.";
          return;
        }
        const taken = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
        if (taken.data) {
          msg.textContent = "That username is taken. Try another.";
          return;
        }
        const { data, error } = await sb.auth.signUp({
          email, password, options: { data: { username } }
        });
        if (error) throw error;
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          msg.textContent = "An account with that email already exists. Try logging in.";
        } else if (!data.session) {
          openCodeStep("signup", email);
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      if (!signingUp && /not confirmed/i.test(err.message || "")) {
        await sb.auth.resend({ type: "signup", email });
        openCodeStep("signup", email);
      } else {
        msg.textContent = err.message || "Something went wrong. Try again.";
      }
    } finally {
      btn.disabled = false;
    }
  });

  // Forgot password: send the reset email
  $("authForgot").addEventListener("click", async () => {
    const msg = $("authMsg");
    const email = $("authEmail").value.trim();
    if (!email) {
      msg.textContent = "Type your email above, then tap Forgot password.";
      return;
    }
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) {
      msg.textContent = "Couldn't send the email. Try again in a minute.";
      return;
    }
    openCodeStep("recovery", email);
  });

  // Set a new password after clicking the link in the reset email
  $("newPassForm").addEventListener("submit", async event => {
    event.preventDefault();
    const msg = $("newPassMsg");
    const { error } = await sb.auth.updateUser({ password: $("newPass").value });
    if (error) {
      msg.textContent = error.message || "Couldn't update your password.";
      return;
    }
    $("newPass").value = "";
    msg.textContent = "";
    alert("Password updated.");
    body.classList.remove("recovering");
    showPage("home");
  });

  // Enter the code from the email (sign-up confirmation or password reset)
  let pending = null;
  let recoveryFlow = false;

  function openCodeStep(type, email) {
    pending = { type, email };
    $("codeMsg").textContent = "We sent a code to " + email + ". Enter it below.";
    $("codeInput").value = "";
    showPage("verifyCode");
  }

  $("codeForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!pending) return;
    const btn = $("codeSubmit");
    btn.disabled = true;
    if (pending.type === "recovery") recoveryFlow = true;
    const { error } = await sb.auth.verifyOtp({
      email: pending.email,
      token: $("codeInput").value.trim(),
      type: pending.type
    });
    btn.disabled = false;
    if (error) {
      recoveryFlow = false;
      $("codeMsg").textContent = "That code didn't work. Check it or tap Resend code.";
    }
  });

  $("codeResend").addEventListener("click", async () => {
    if (!pending) return;
    const { error } = pending.type === "signup"
      ? await sb.auth.resend({ type: "signup", email: pending.email })
      : await sb.auth.resetPasswordForEmail(pending.email);
    $("codeMsg").textContent = error
      ? "Couldn't resend yet. Wait a minute and try again."
      : "A new code is on its way to " + pending.email + ".";
  });

  $("codeBack").addEventListener("click", () => showPage("auth"));

  $("logoutBtn").addEventListener("click", () => sb.auth.signOut());

  // React to login / logout (also fires once on page load with any saved session)
  async function enter(session) {
    if (session) {
      if (me && me.id === session.user.id) return; // token refresh, nothing to do
      me = session.user;
      body.classList.remove("logged-out");
      showPage("home");
      await safe("Profile check", ensureProfile);
      await Promise.all([safe("Blocked list", loadBlocked), safe("Taste", loadTaste)]);
      setFeedTab("foryou");
      await Promise.all([
        safe("Feed", loadFeed),
        safe("Profile", loadProfile),
        safe("Explore", loadExplore),
        safe("Notifications", loadNotifications)
      ]);
    } else {
      me = null;
      blocked = new Set();
      body.classList.add("logged-out");
      clearFeed();
      showPage("auth");
    }
  }

  setTimeout(() => {
    if (body.classList.contains("booting")) {
      body.classList.remove("booting");
      if (!me) showPage("auth");
      window.vyroBanner?.("VYRO took too long to start. Reload the page. If it keeps happening, check your Supabase project is running.");
    }
  }, 8000);

  sb.auth.onAuthStateChange((event, session) => {
    // setTimeout avoids a known deadlock when calling Supabase inside this callback
    setTimeout(() => enter(session)
      .then(() => {
        if (event === "PASSWORD_RECOVERY" || recoveryFlow) {
          recoveryFlow = false;
          body.classList.add("recovering");
          showPage("newPassword");
        }
      })
      .catch(err => {
        console.error(err);
        window.vyroBanner?.("Startup problem: " + (err.message || err));
      })
      .finally(() => body.classList.remove("booting")), 0);
  });
})();
