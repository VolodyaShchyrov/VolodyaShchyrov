const username = "MR-kartoshki";
const endpoint = `https://api.github.com/users/${username}/repos`;

const projectsGrid = document.getElementById("projectsGrid");
const statusMessage = document.getElementById("statusMessage");
const searchInput = document.getElementById("searchInput");
const languageFilter = document.getElementById("languageFilter");
const hideForksToggle = document.getElementById("hideForksToggle");
const homeGithubLink = document.getElementById("homeGithubLink");
const contactGithubLink = document.getElementById("contactGithubLink");

const state = {
  repos: [],
};

homeGithubLink.href = `https://github.com/${username}`;
contactGithubLink.href = `https://github.com/${username}`;

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

function createProjectCard(repo) {
  const card = document.createElement("article");
  card.className = "project-card";

  const description = repo.description ? repo.description : "No description provided.";
  const language = repo.language ? repo.language : "Not specified";

  const title = document.createElement("h3");
  title.className = "project-title";
  title.textContent = repo.name;

  const descriptionText = document.createElement("p");
  descriptionText.textContent = description;

  const meta = document.createElement("p");
  meta.className = "project-meta";
  meta.textContent = `Language: ${language}`;

  const link = document.createElement("a");
  link.className = "button";
  link.href = repo.html_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View repository";

  card.append(title, descriptionText, meta, link);

  return card;
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
  setStatus(`Showing ${filteredRepos.length} repositories.`);
}

async function fetchRepositories() {
  setStatus("Loading repositories...", "loading");
  projectsGrid.innerHTML = "";

  try {
    const response = await fetch(endpoint, {
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

    state.repos = repos.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    updateLanguageFilterOptions(state.repos);
    renderProjects();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    setStatus(`Failed to load repositories: ${message}`, "error");
  }
}

searchInput.addEventListener("input", renderProjects);
languageFilter.addEventListener("change", renderProjects);
hideForksToggle.addEventListener("change", renderProjects);

fetchRepositories();
