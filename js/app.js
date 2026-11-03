/*
 * IT 4403 - Milestone 3: Open Library Single Page Application
 * David Tarver
 * All remote data is retrieved using jQuery AJAX. No frontend frameworks are used.
 */
$(function () {
  "use strict";

  const SEARCH_LIMIT = 50;
  const PAGE_SIZE = 10;
  const SUBJECT = "science_fiction";
  const API_ROOT = "https://openlibrary.org";

  // Shared SPA state. Page changes operate on the same in-memory search results.
  const state = {
    searchTerm: "",
    searchBooks: [],
    totalMatches: 0,
    currentPage: 1,
    searchLoading: false,
    collectionBooks: [],
    selectedWorkId: "",
    detailVersion: 0,
    detailCache: new Map(),
    authorCache: new Map()
  };

  function textValue(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function getWorkId(key) {
    const match = typeof key === "string" ? key.match(/(?:^|\/)\b(OL\d+W)$/) : null;
    return match ? match[1] : "";
  }

  function coverId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  function authorNames(raw) {
    if (Array.isArray(raw.author_name)) {
      return raw.author_name.filter(function (name) { return typeof name === "string" && !!name.trim(); }).slice(0, 5);
    }
    if (Array.isArray(raw.authors)) {
      return raw.authors.map(function (author) { return author && author.name; })
        .filter(function (name) { return typeof name === "string" && !!name.trim(); }).slice(0, 5);
    }
    return [];
  }

  // Search documents and subject works have different fields; normalize both.
  function normalizeBook(raw) {
    return {
      id: getWorkId(raw && raw.key),
      title: textValue(raw && raw.title, "Untitled book"),
      cover: coverId(raw && (raw.cover_i || raw.cover_id || (Array.isArray(raw.covers) ? raw.covers[0] : 0))),
      authors: authorNames(raw || {})
    };
  }

  function setMessage(selector, message, type) {
    $(selector).removeClass("error success").addClass(type || "").text(message).prop("hidden", false);
  }

  function hideMessage(selector) {
    $(selector).prop("hidden", true);
  }

  function showEmpty($target, heading, body, isLoading) {
    const $empty = $("<div>", { "class": "empty-state" + (isLoading ? " loading-state" : "") });
    $empty.append($("<strong>").text(heading));
    $empty.append($("<p>").text(body));
    $target.empty().append($empty);
  }

  // Broken images and absent cover IDs produce a readable placeholder.
  function makeCover(title, id, size) {
    const $wrap = $("<div>", { "class": size === "L" ? "detail-cover" : "cover-wrap" });
    const $fallback = $("<div>", { "class": "no-cover" }).text("Cover not available");
    if (!id) return $wrap.append($fallback);

    const url = "https://covers.openlibrary.org/b/id/" + id + "-" + (size || "M") + ".jpg?default=false";
    const $image = $("<img>", {
      src: url,
      alt: "Cover of " + title,
      loading: "lazy"
    });
    $image.on("error", function () { $wrap.empty().append($fallback); });
    return $wrap.append($image);
  }

  function makeCard(book) {
    const $card = $("<article>", { "class": "book-card" });
    if (state.selectedWorkId && book.id === state.selectedWorkId) $card.addClass("is-selected");

    const $body = $("<div>", { "class": "book-card-body" });
    $body.append($("<h3>").text(book.title));
    $body.append($("<span>", { "class": "book-id" }).text("Work ID: " + (book.id || "Unavailable")));
    if (book.authors.length) {
      $body.append($("<span>", { "class": "book-author" }).text(book.authors.slice(0, 2).join(", ")));
    }

    if (!book.id) {
      $card.append(makeCover(book.title, book.cover, "M"), $body);
      return $card;
    }
    const $button = $("<button>", { type: "button", "class": "book-pick" })
      .attr("aria-label", "View details for " + book.title)
      .data("book", book);
    $button.append(makeCover(book.title, book.cover, "M"), $body);
    return $card.append($button);
  }

  function highlightSelection() {
    $(".book-card").each(function () {
      const book = $(this).find(".book-pick").data("book");
      $(this).toggleClass("is-selected", Boolean(book && book.id === state.selectedWorkId));
    });
  }

  function renderPagination() {
    const pageCount = Math.ceil(state.searchBooks.length / PAGE_SIZE);
    const $bar = $("#paginationRegion");
    const $buttons = $("#pageButtons").empty();
    $bar.prop("hidden", pageCount <= 1);
    if (!pageCount) return;

    for (let page = 1; page <= pageCount; page++) {
      const $button = $("<button>", { type: "button" }).text(page).attr("aria-label", "Page " + page);
      if (page === state.currentPage) {
        $button.addClass("active-page").attr("aria-current", "page");
      }
      $button.data("page", page);
      $buttons.append($button);
    }

    $("#previousPage").prop("disabled", state.currentPage === 1);
    $("#nextPage").prop("disabled", state.currentPage === pageCount);
    $("#pageIndicator").text("Page " + state.currentPage + " of " + pageCount);
  }

  function showSearchPage(page) {
    const count = state.searchBooks.length;
    const pageCount = Math.ceil(count / PAGE_SIZE);
    if (!pageCount || page < 1 || page > pageCount) return;

    state.currentPage = page;
    const start = (page - 1) * PAGE_SIZE;
    const books = state.searchBooks.slice(start, start + PAGE_SIZE);
    const $grid = $("#resultsGrid").empty();
    books.forEach(function (book) { $grid.append(makeCard(book)); });

    const range = (start + 1) + "–" + (start + books.length);
    const cappedNotice = state.totalMatches > SEARCH_LIMIT ? " (first 50 available)" : "";
    $("#resultSummary").text("Showing " + range + " of " + count + cappedNotice + ' for "' + state.searchTerm + '".');
    renderPagination();
    highlightSelection();
  }

  function setSearchLoading(loading) {
    state.searchLoading = loading;
    $("#searchButton").prop("disabled", loading).text(loading ? "Searching…" : "Search →");
    $("#searchInput").prop("disabled", loading);
    $("#resultsSection").attr("aria-busy", String(loading));
  }

  function runSearch(term) {
    setSearchLoading(true);
    state.searchTerm = term;
    state.searchBooks = [];
    state.currentPage = 1;
    state.totalMatches = 0;
    $("#paginationRegion").prop("hidden", true);
    $("#resultSummary").text("Requesting Open Library search results…");
    showEmpty($("#resultsGrid"), "Searching the catalog", "Retrieving matching books from Open Library…", true);
    hideMessage("#searchMessage");

    $.ajax({
      url: API_ROOT + "/search.json",
      method: "GET",
      dataType: "json",
      data: { q: term, limit: SEARCH_LIMIT, fields: "key,title,author_name,cover_i" },
      timeout: 20000
    }).done(function (response) {
      const docs = response && Array.isArray(response.docs) ? response.docs : [];
      state.searchBooks = docs.slice(0, SEARCH_LIMIT).map(normalizeBook);
      const reported = Number(response && (response.numFound ?? response.num_found));
      state.totalMatches = Number.isFinite(reported) && reported >= 0 ? reported : state.searchBooks.length;
      if (!state.searchBooks.length) {
        $("#resultSummary").text("0 results for \"" + term + "\".");
        showEmpty($("#resultsGrid"), "No books found", "Try a different title, keyword or spelling.", false);
        setMessage("#searchMessage", 'No books matched "' + term + '". Try a different search.', "error");
        return;
      }
      hideMessage("#searchMessage");
      showSearchPage(1);
    }).fail(function (_xhr, status) {
      $("#resultSummary").text("Search unavailable.");
      showEmpty($("#resultsGrid"), "Search could not load", "Check your connection and try the Search button again.", false);
      setMessage("#searchMessage", status === "timeout" ?
        "Open Library took too long to respond. Please try again." :
        "The Open Library search request failed. Check your connection and try again.", "error");
    }).always(function () { setSearchLoading(false); });
  }

  // These titles are requested from the subject endpoint; none are hard-coded.
  function loadCollection() {
    $("#collectionSection").attr("aria-busy", "true");
    $("#retryCollection").prop("hidden", true);
    $("#collectionGrid").empty();
    setMessage("#collectionMessage", "Loading the science fiction collection…", "");

    $.ajax({
      url: API_ROOT + "/subjects/" + SUBJECT + ".json",
      method: "GET",
      dataType: "json",
      data: { limit: 10 },
      timeout: 20000
    }).done(function (response) {
      const works = response && Array.isArray(response.works) ? response.works : [];
      state.collectionBooks = works.slice(0, 10).map(normalizeBook);
      if (!state.collectionBooks.length) {
        setMessage("#collectionMessage", "No books are currently available in this collection.", "error");
        return;
      }
      const $grid = $("#collectionGrid").empty();
      state.collectionBooks.forEach(function (book) { $grid.append(makeCard(book)); });
      hideMessage("#collectionMessage");
      highlightSelection();
    }).fail(function () {
      setMessage("#collectionMessage", "The collection could not be loaded. Check your connection and retry.", "error");
      $("#retryCollection").prop("hidden", false);
    }).always(function () { $("#collectionSection").attr("aria-busy", "false"); });
  }

  function descriptionText(work) {
    const description = work && work.description;
    if (typeof description === "string" && description.trim()) return description.trim();
    if (description && typeof description.value === "string" && description.value.trim()) return description.value.trim();
    return "No description available for this book.";
  }

  function workAuthors(work) {
    if (!work || !Array.isArray(work.authors)) return [];
    return work.authors.map(function (entry) {
      return entry && ((entry.author && entry.author.key) || entry.key);
    }).filter(function (key) { return typeof key === "string" && /^\/authors\/OL\d+A$/.test(key); }).slice(0, 4);
  }

  function showDetails(work, book, token) {
    if (token !== state.detailVersion) return;
    const title = textValue(work && work.title, book.title);
    const worksCover = work && Array.isArray(work.covers) && work.covers.length ? coverId(work.covers[0]) : 0;
    const $content = $("#detailsContent").empty();
    const $body = $("<div>", { "class": "detail-body" });
    $body.append($("<p>", { "class": "kicker" }).text("Selected work"));
    $body.append($("<h3>").text(title));

    const $meta = $("<div>", { "class": "detail-meta" });
    const $idSection = $("<div>").append($("<span>", { "class": "meta-label" }).text("Work ID"), $("<p>").text(book.id));
    const $authorSection = $("<div>").append($("<span>", { "class": "meta-label" }).text("Authors"));
    const $authorText = $("<p>").text(book.authors.length ? book.authors.join(", ") : "Checking author information…");
    $authorSection.append($authorText);
    $meta.append($idSection, $authorSection);
    $body.append($meta);

    $body.append($("<span>", { "class": "meta-label" }).text("Description"));
    $body.append($("<p>", { "class": "detail-description" }).text(descriptionText(work)));
    $body.append($("<span>", { "class": "meta-label" }).text("Subjects (up to 10)"));
    const subjects = work && Array.isArray(work.subjects) ?
      work.subjects.filter(function (x) { return typeof x === "string" && !!x.trim(); }).slice(0, 10) : [];
    if (subjects.length) {
      const $list = $("<ul>", { "class": "subjects" });
      subjects.forEach(function (subject) { $list.append($("<li>").text(subject)); });
      $body.append($list);
    } else {
      $body.append($("<p>", { "class": "detail-description" }).text("No subjects available for this book."));
    }
    $body.append($("<a>", {
      "class": "external-link",
      href: API_ROOT + "/works/" + book.id,
      target: "_blank",
      rel: "noopener noreferrer"
    }).text("View on Open Library ↗"));
    $content.append(makeCover(title, worksCover || book.cover, "L"), $body);
    $("#detailsSection").attr("aria-busy", "false");

    // Search/subject results commonly include author names. If not, get them
    // from the author records referenced by the selected Work, never every card.
    if (book.authors.length) return;
    const keys = workAuthors(work);
    if (!keys.length) { $authorText.text("Author information unavailable."); return; }
    const names = keys.map(function (key) { return state.authorCache.get(key) || ""; });
    if (names.every(Boolean)) { $authorText.text(names.join(", ")); return; }
    const requests = keys.map(function (key) {
      if (state.authorCache.has(key)) return $.Deferred().resolve({ name: state.authorCache.get(key) }).promise();
      return $.ajax({ url: API_ROOT + key + ".json", method: "GET", dataType: "json", timeout: 12000 })
        .then(function (data) {
          const name = textValue(data && data.name, "");
          if (name) state.authorCache.set(key, name);
          return { name: name };
        }, function () { return { name: "" }; });
    });
    $.when.apply($, requests).done(function () {
      if (token !== state.detailVersion) return;
      const values = Array.from(arguments).map(function (value) { return value && value.name; }).filter(Boolean);
      $authorText.text(values.length ? values.join(", ") : "Author information unavailable.");
    });
  }

  function selectBook(book) {
    if (!book || !book.id) return;
    state.selectedWorkId = book.id;
    const token = ++state.detailVersion;
    highlightSelection();
    $("#detailsSection").attr("aria-busy", "true");
    $("#detailsContent").empty().append($("<div>", { "class": "details-empty loading-state detail-loading" })
      .append($("<strong>").text("Loading book details"))
      .append($("<p>").text("Requesting " + book.title + " from Open Library…")));

    // On narrow screens bring the already-present details section into view.
    if (window.matchMedia("(max-width: 770px)").matches) {
      document.getElementById("detailsSection").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const cached = state.detailCache.get(book.id);
    if (cached) { showDetails(cached, book, token); return; }
    $.ajax({
      url: API_ROOT + "/works/" + book.id + ".json",
      method: "GET",
      dataType: "json",
      timeout: 20000
    }).done(function (work) {
      if (token !== state.detailVersion) return;
      state.detailCache.set(book.id, work);
      showDetails(work, book, token);
    }).fail(function () {
      if (token !== state.detailVersion) return;
      $("#detailsContent").empty().append($("<div>", { "class": "detail-error" })
        .append($("<strong>").text("Book details unavailable"))
        .append($("<p>").text("Open Library could not load " + book.title + ". Select the book again to retry.")));
      $("#detailsSection").attr("aria-busy", "false");
    });
  }

  $("#searchForm").on("submit", function (event) {
    event.preventDefault();
    if (state.searchLoading) return;
    const term = String($("#searchInput").val() || "").trim();
    if (!term) {
      setMessage("#searchMessage", "Please enter a title or keyword before searching.", "error");
      $("#searchInput").trigger("focus");
      return;
    }
    runSearch(term);
  });

  $("#pageButtons").on("click", "button", function () {
    showSearchPage(Number($(this).data("page")));
  });
  $("#previousPage").on("click", function () { showSearchPage(state.currentPage - 1); });
  $("#nextPage").on("click", function () { showSearchPage(state.currentPage + 1); });
  $("#resultsGrid, #collectionGrid").on("click", ".book-pick", function () {
    selectBook($(this).data("book"));
  });
  $("#retryCollection").on("click", loadCollection);

  loadCollection();
});
