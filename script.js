const username = "MR-kartoshki";
const apiEndpoint = `https://api.github.com/users/${username}/repos`;
const cacheEndpoint = "./data/repos-cache.json";

const projectsGrid = document.getElementById("projectsGrid");
const statusMessage = document.getElementById("statusMessage");
const searchInput = document.getElementById("searchInput");
const languageFilter = document.getElementById("languageFilter");
const hideForksToggle = document.getElementById("hideForksToggle");
const homeGithubLink = document.getElementById("homeGithubLink");
const contactGithubLink = document.getElementById("contactGithubLink");
const contactFormToggle = document.getElementById("contactFormToggle");
const contactFormPanel = document.getElementById("contactFormPanel");
const contactNameInput = document.getElementById("contactName");
const contactForm = document.querySelector(".contact-form");
const contactSubmitButton = document.getElementById("contactSubmitButton");
const contactFormStatus = document.getElementById("contactFormStatus");

const state = {
  repos: [],
  repoLanguages: new Map(),
  hasIncompleteLanguageData: false,
};
const skeletonCardCount = 6;
const maxExpandedLanguageCount = 3;
const messageCooldownMs = 10_000;
const cooldownStorageKey = "contactFormLastSentAt";
const cooldownTickMs = 250;
const cacheFreshnessMs = 10 * 60_000;

let contactCooldownIntervalId;

const updatedDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

homeGithubLink.href = `https://github.com/${username}`;
contactGithubLink.href = `https://github.com/${username}`;

if (contactFormToggle && contactFormPanel) {
  contactFormToggle.addEventListener("click", () => {
    const isHidden = contactFormPanel.hasAttribute("hidden");

    if (isHidden) {
      contactFormPanel.removeAttribute("hidden");
      contactFormToggle.setAttribute("aria-expanded", "true");
      contactFormToggle.textContent = "Hide email form";
      contactNameInput?.focus();
      return;
    }

    contactFormPanel.setAttribute("hidden", "");
    contactFormToggle.setAttribute("aria-expanded", "false");
    contactFormToggle.textContent = "Send email";
  });
}

function setContactFormMessage(message, type = "info") {
  if (!contactFormStatus) {
    return;
  }

  contactFormStatus.textContent = message;
  contactFormStatus.classList.remove("contact-form-status--warning");

  if (type === "warning") {
    contactFormStatus.classList.add("contact-form-status--warning");
  }
}

function formatCooldownSeconds(remainingMs) {
  return `${Math.ceil(remainingMs / 1000)}s`;
}

function getRemainingCooldownMs() {
  const lastSentAt = Number(localStorage.getItem(cooldownStorageKey));

  if (!Number.isFinite(lastSentAt) || lastSentAt <= 0) {
    return 0;
  }

  return Math.max(0, messageCooldownMs - (Date.now() - lastSentAt));
}

function triggerSendButtonReaction(reactionClassName) {
  if (!contactSubmitButton) {
    return;
  }

  contactSubmitButton.classList.remove("button--pressed", "button--blocked");
  // Force a reflow so repeated clicks replay the animation.
  void contactSubmitButton.offsetWidth;
  contactSubmitButton.classList.add(reactionClassName);
}

function updateContactSubmitButton(remainingMs) {
  if (!contactSubmitButton) {
    return;
  }

  if (remainingMs > 0) {
    contactSubmitButton.disabled = true;
    contactSubmitButton.classList.add("button--cooldown");
    contactSubmitButton.textContent = `Wait ${formatCooldownSeconds(remainingMs)}`;
    return;
  }

  contactSubmitButton.disabled = false;
  contactSubmitButton.classList.remove("button--cooldown");
  contactSubmitButton.textContent = "Send message";
}

function startContactCooldown() {
  if (contactCooldownIntervalId) {
    window.clearInterval(contactCooldownIntervalId);
    contactCooldownIntervalId = undefined;
  }

  const startingRemainingMs = getRemainingCooldownMs();
  updateContactSubmitButton(startingRemainingMs);

  if (startingRemainingMs <= 0) {
    return;
  }

  contactCooldownIntervalId = window.setInterval(() => {
    const remainingMs = getRemainingCooldownMs();
    updateContactSubmitButton(remainingMs);

    if (remainingMs <= 0) {
      window.clearInterval(contactCooldownIntervalId);
      contactCooldownIntervalId = undefined;
      setContactFormMessage("");
    }
  }, cooldownTickMs);
}

if (contactForm && contactSubmitButton) {
  startContactCooldown();

  contactForm.addEventListener("submit", (event) => {
    const remainingMs = getRemainingCooldownMs();

    if (remainingMs > 0) {
      event.preventDefault();
      triggerSendButtonReaction("button--blocked");
      setContactFormMessage(
        `Please wait ${formatCooldownSeconds(remainingMs)} before sending another message.`,
        "warning"
      );
      startContactCooldown();
      return;
    }

    localStorage.setItem(cooldownStorageKey, String(Date.now()));
    triggerSendButtonReaction("button--pressed");
    setContactFormMessage("Sending your message...");
    startContactCooldown();
  });
}

function setStatus(message, type = "info") {
  statusMessage.textContent = message;
  statusMessage.classList.remove("error");
  statusMessage.classList.remove("loading");

  if (type === "error") {
    statusMessage.classList.add("error");
  }

  if (type === "loading") {
    statusMessage.classList.add("loading");
  }
}

function formatUpdatedDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return updatedDateFormatter.format(date);
}

function formatRepoLanguages(repo) {
  const languages = state.repoLanguages.get(repo.id);

  if (!Array.isArray(languages) || languages.length === 0) {
    return repo.language ? repo.language : "Not specified";
  }

  if (languages.length <= maxExpandedLanguageCount) {
    return languages.join(", ");
  }

  const [mainLanguage, ...otherLanguages] = languages;
  return `${mainLanguage} + ${otherLanguages.length} others`;
}

async function loadRepoLanguages(repos) {
  const languageRequests = repos.map(async (repo) => {
    const response = await fetch(repo.languages_url, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}.`);
    }

    const payload = await response.json();

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Unexpected API response.");
    }

    const languages = Object.entries(payload)
      .filter(([, bytes]) => typeof bytes === "number")
      .sort(([, leftBytes], [, rightBytes]) => rightBytes - leftBytes)
      .map(([language]) => language);

    return {
      repoId: repo.id,
      languages,
    };
  });

  const results = await Promise.allSettled(languageRequests);
  const repoLanguages = new Map();
  let hasFailures = false;

  for (const [index, result] of results.entries()) {
    const repo = repos[index];

    if (result.status === "fulfilled") {
      repoLanguages.set(result.value.repoId, result.value.languages);
      continue;
    }

    hasFailures = true;
    repoLanguages.set(repo.id, repo.language ? [repo.language] : []);
  }

  state.repoLanguages = repoLanguages;
  state.hasIncompleteLanguageData = hasFailures;
}

function createProjectCard(repo) {
  const card = document.createElement("article");
  card.className = "project-card";

  const description = repo.description ? repo.description : "No description provided.";
  const languageSummary = formatRepoLanguages(repo);
  const stars = typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0;
  const forks = typeof repo.forks_count === "number" ? repo.forks_count : 0;
  const lastUpdated = formatUpdatedDate(repo.updated_at);

  const title = document.createElement("h3");
  title.className = "project-title";
  title.textContent = repo.name;

  const descriptionText = document.createElement("p");
  descriptionText.textContent = description;

  const meta = document.createElement("p");
  meta.className = "project-meta";
  meta.textContent = `Language: ${languageSummary}`;

  const stats = document.createElement("div");
  stats.className = "project-stats";
  const statsLine = document.createElement("p");
  statsLine.className = "project-stats-line";
  statsLine.textContent = `Stars: ${stars} · Forks: ${forks}`;

  const updatedLine = document.createElement("p");
  updatedLine.className = "project-updated";
  updatedLine.textContent = `Updated: ${lastUpdated}`;
  stats.append(statsLine, updatedLine);

  const link = document.createElement("a");
  link.className = "button";
  link.href = repo.html_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View repository";

  card.append(title, descriptionText, meta, stats, link);

  return card;
}

function createSkeletonCard() {
  const card = document.createElement("article");
  card.className = "project-card project-card--skeleton";
  card.setAttribute("aria-hidden", "true");

  const title = document.createElement("div");
  title.className = "skeleton-line skeleton-title";

  const description = document.createElement("div");
  description.className = "skeleton-line skeleton-description";

  const shortDescription = document.createElement("div");
  shortDescription.className = "skeleton-line skeleton-description short";

  const spacer = document.createElement("div");
  spacer.className = "skeleton-spacer";

  const meta = document.createElement("div");
  meta.className = "skeleton-line skeleton-meta";

  const stats = document.createElement("div");
  stats.className = "project-stats";

  const statsLine = document.createElement("div");
  statsLine.className = "skeleton-line skeleton-stats-line";

  const updatedLine = document.createElement("div");
  updatedLine.className = "skeleton-line skeleton-updated-line";
  stats.append(statsLine, updatedLine);

  const button = document.createElement("div");
  button.className = "skeleton-line skeleton-button";

  card.append(title, description, shortDescription, spacer, meta, stats, button);
  return card;
}

function renderLoadingSkeletons(count = skeletonCardCount) {
  projectsGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < count; index += 1) {
    fragment.append(createSkeletonCard());
  }

  projectsGrid.append(fragment);
}

function updateLanguageFilterOptions(repos) {
  const languages = Array.from(
    new Set(repos.map((repo) => repo.language).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const currentValue = languageFilter.value;
  languageFilter.innerHTML = '<option value="all">All languages</option>';

  for (const language of languages) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    languageFilter.append(option);
  }

  if (languages.includes(currentValue)) {
    languageFilter.value = currentValue;
  }
}

function getFilteredRepos() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const selectedLanguage = languageFilter.value;
  const hideForks = hideForksToggle.checked;

  return state.repos.filter((repo) => {
    if (hideForks && repo.fork) {
      return false;
    }

    if (selectedLanguage !== "all" && repo.language !== selectedLanguage) {
      return false;
    }

    if (searchTerm && !repo.name.toLowerCase().includes(searchTerm)) {
      return false;
    }

    return true;
  });
}

function renderProjects() {
  projectsGrid.innerHTML = "";
  const filteredRepos = getFilteredRepos();

  if (filteredRepos.length === 0) {
    setStatus("No repositories match the current filters.");
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const repo of filteredRepos) {
    fragment.append(createProjectCard(repo));
  }

  projectsGrid.append(fragment);
  const languageWarning = state.hasIncompleteLanguageData
    ? " Some language details are unavailable."
    : "";
  setStatus(`Showing ${filteredRepos.length} repositories.${languageWarning}`);
}

function sortReposByUpdatedDate(repos) {
  return repos.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

async function fetchCachedRepositories() {
  const response = await fetch(cacheEndpoint, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Cache file returned status ${response.status}.`);
  }

  const payload = await response.json();

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Unexpected cache payload.");
  }

  if (!Array.isArray(payload.repos)) {
    throw new Error("Unexpected cache repositories payload.");
  }

  const repoLanguages = new Map();

  if (
    payload.repo_languages &&
    typeof payload.repo_languages === "object" &&
    !Array.isArray(payload.repo_languages)
  ) {
    for (const [repoId, languages] of Object.entries(payload.repo_languages)) {
      const numericRepoId = Number(repoId);

      if (Number.isNaN(numericRepoId) || !Array.isArray(languages)) {
        continue;
      }

      repoLanguages.set(
        numericRepoId,
        languages.filter((language) => typeof language === "string")
      );
    }
  }

  return {
    repos: sortReposByUpdatedDate(payload.repos),
    repoLanguages,
    hasIncompleteLanguageData: Boolean(payload.has_incomplete_language_data),
    generatedAtMs: Number(Date.parse(payload.generated_at)),
  };
}

function applyCachedRepositories(cachedData) {
  state.repos = cachedData.repos;
  state.repoLanguages = cachedData.repoLanguages;
  state.hasIncompleteLanguageData = cachedData.hasIncompleteLanguageData;
  updateLanguageFilterOptions(state.repos);
  renderProjects();
}

function isCacheStale(generatedAtMs) {
  if (!Number.isFinite(generatedAtMs)) {
    return true;
  }

  return Date.now() - generatedAtMs > cacheFreshnessMs;
}

async function fetchRepositoriesFromApi() {
  const response = await fetch(apiEndpoint, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("GitHub API rate limit reached. Please try again later.");
    }

    throw new Error(`GitHub API returned status ${response.status}.`);
  }

  const repos = await response.json();

  if (!Array.isArray(repos)) {
    throw new Error("Unexpected API response.");
  }

  const sortedRepos = sortReposByUpdatedDate(repos);
  await loadRepoLanguages(sortedRepos);
  return sortedRepos;
}

async function refreshRepositoriesSilently() {
  try {
    state.repos = await fetchRepositoriesFromApi();
    updateLanguageFilterOptions(state.repos);
    renderProjects();
  } catch (error) {
    console.warn("Background repository refresh failed.", error);
  }
}

async function fetchRepositories() {
  setStatus("Loading repositories...", "loading");
  renderLoadingSkeletons();

  try {
    const cachedData = await fetchCachedRepositories();
    applyCachedRepositories(cachedData);

    if (isCacheStale(cachedData.generatedAtMs)) {
      void refreshRepositoriesSilently();
    }

    return;
  } catch (cacheError) {
    try {
      state.repos = await fetchRepositoriesFromApi();
      updateLanguageFilterOptions(state.repos);
      renderProjects();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      const cacheMessage =
        cacheError instanceof Error ? cacheError.message : "Unknown cache error.";
      setStatus(`Failed to load repositories: ${message} (cache error: ${cacheMessage})`, "error");
    }
  }
}

searchInput.addEventListener("input", renderProjects);
languageFilter.addEventListener("change", renderProjects);
hideForksToggle.addEventListener("change", renderProjects);

fetchRepositories();
