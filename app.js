(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const flags = {
    firstTime: params.get("firstTime") !== "0",
    emptyHistory: params.get("history") === "empty",
  };

  const demoHistory = flags.emptyHistory
    ? []
    : [
        { id: "r4-l2-b-5", relative: "2 hours ago", date: "9/2/26", level: 2, zone: "B", stall: 5 },
        { id: "r4-l4-d-zone", relative: null, date: "8/24/26", level: 4, zone: "D", stall: null },
        { id: "r4-l1-a-2", relative: null, date: "7/18/26", level: 1, zone: "A", stall: 2 },
      ];

  const state = {
    screen: flags.firstTime ? "warning" : "welcome",
    stack: [],
    selectedVehicle: "sedan",
    selectedColor: "red",
    selectedLevel: null,
    selectedZone: null,
    selectedStall: null,
    history: demoHistory,
    activeHistoryId: null,
    retrievalId: null,
  };

  const vehicleColors = {
    black: "#202024",
    silver: "#c7c8cb",
    grey: "#77787d",
    white: "#f5f3ee",
    blue: "#2b72d6",
    red: "#e33b4e",
    pink: "#ef68ab",
  };

  const screen = document.querySelector("#screen");
  const app = document.querySelector("#app");
  const backButton = document.querySelector("#backButton");
  const homeButton = document.querySelector("#homeButton");
  const settingsButton = document.querySelector("#settingsButton");
  const settingsOverlay = document.querySelector("#settingsOverlay");
  const toast = document.querySelector("#toast");
  let toastTimer;

  function cubeMarkup() {
    return `
      <div class="cube-scene" aria-label="Spinning garage model placeholder" role="img">
        <div class="cube-face cube-front"></div>
        <div class="cube-face cube-back"></div>
        <div class="cube-face cube-right"></div>
        <div class="cube-face cube-left"></div>
        <div class="cube-face cube-top"></div>
        <div class="cube-face cube-bottom"></div>
      </div>`;
  }

  function vehicleShape(type = state.selectedVehicle, color = vehicleColors[state.selectedColor]) {
    return `<div class="vehicle-shape ${type}" style="--vehicle-color: ${color}" aria-hidden="true"></div>`;
  }

  function carPosition(zone, stall) {
    const positions = {
      A: { top: 9, left: 8 },
      B: { top: 9, left: 67 },
      C: { top: 62, left: 8 },
      D: { top: 62, left: 67 },
    };
    const base = positions[zone] || positions.A;
    const columnOffset = stall % 2 === 0 ? 14 : 0;
    const rowOffset = Math.floor((stall - 1) / 2) * 6;
    return `top:${base.top + rowOffset}%;left:${base.left + columnOffset}%`;
  }

  function garagePlan({ interactive = false, selectedZone = null, selectedStall = null, parkedLocation = null, preview = false } = {}) {
    const zones = ["A", "B", "C", "D"];
    return `
      <div class="garage-plan${preview ? " preview" : ""}" aria-label="Parking garage floor plan placeholder">
        <div class="structure elevator">lift</div>
        <div class="structure stairs">stairs</div>
        <div class="structure ramp">ramp</div>
        <span class="structure column c1"></span>
        <span class="structure column c2"></span>
        <span class="structure column c3"></span>
        <span class="structure column c4"></span>
        ${interactive
          ? zones.map((zone) => `
              <button class="zone zone-${zone.toLowerCase()}${selectedZone === zone ? " selected stalls-active" : ""}"
                type="button" data-zone="${zone}" aria-label="Select zone ${zone}">
                <span class="zone-label">${zone}</span>
                ${[1, 2, 3, 4, 5, 6].map((stall) => `
                  <span class="stall${selectedZone === zone && selectedStall === stall ? " selected" : ""}"
                    data-stall="${stall}" role="button" tabindex="${selectedZone === zone ? "0" : "-1"}" aria-label="Stall ${stall}"></span>`).join("")}
              </button>`).join("")
          : ""}
        ${parkedLocation && parkedLocation.stall
          ? `<div class="parked-car" style="${carPosition(parkedLocation.zone, parkedLocation.stall)}; --vehicle-color: ${vehicleColors[state.selectedColor]}" aria-label="Your ${state.selectedColor} ${state.selectedVehicle}"></div>`
          : ""}
        ${parkedLocation && !parkedLocation.stall
          ? `<div class="zone-focus" data-zone="${parkedLocation.zone}" aria-label="Saved zone ${parkedLocation.zone}"></div>`
          : ""}
      </div>`;
  }

  function navigate(next, { replace = false } = {}) {
    if (!replace) state.stack.push(state.screen);
    state.screen = next;
    render();
  }

  function goBack() {
    const previous = state.stack.pop();
    if (!previous) return;
    state.screen = previous;
    render();
  }

  function goHome() {
    state.stack = [];
    state.screen = "welcome";
    state.retrievalId = null;
    render();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2400);
  }

  function closeSettings() {
    settingsOverlay.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }

  function renderWelcome() {
    return `
      <div class="screen-purple welcome-layout">
        <div class="welcome-copy">
          <p class="eyebrow">R4 garage</p>
          <h1>Where to?</h1>
          <p class="lede">Save your spot now, or pick up the trail back to your car.</p>
        </div>
        <div class="garage-orbit">${cubeMarkup()}</div>
        <div class="welcome-actions">
          <button class="primary-button" type="button" data-action="retrieve">find my car</button>
          <button class="primary-button" type="button" data-action="save">save where you parked</button>
          <button class="text-button" type="button" data-action="history">see past vehicle locations</button>
        </div>
      </div>`;
  }

  function renderWarning() {
    return `
      <div class="screen-purple warning-layout">
        <div class="warning-mark" aria-hidden="true">!</div>
        <p class="eyebrow">Before you begin</p>
        <h1>Keep your parking data with you.</h1>
        <p class="lede">Add Parking Helper to your home screen so your saved spot, vehicle, and preferences are not lost.</p>
        <p class="lede" style="margin-top: 18px">Home screen installation steps will be added here in a future version.</p>
        <button class="primary-button bottom-action full" type="button" data-action="warning-okay">okay</button>
      </div>`;
  }

  function renderSetupIntro() {
    return `
      <div class="screen-purple intro-layout">
        <div class="intro-icon" aria-hidden="true"></div>
        <p class="eyebrow">Welcome</p>
        <h1>parking helper</h1>
        <p class="lede" style="margin-inline: auto">A small head start makes finding your car much easier.</p>
        <button class="primary-button" type="button" data-action="choose-vehicle">select my vehicle</button>
      </div>`;
  }

  function renderVehicleSelection() {
    const vehicles = ["sedan", "suv", "truck", "motorcycle"];
    return `
      <div class="screen-light selection-layout">
        <span class="step-count">Vehicle setup · 1 of 2</span>
        <p class="eyebrow dark">Make it recognizable</p>
        <h1>What do you drive?</h1>
        <p class="lede dark">Swipe through the shapes and choose the closest match.</p>
        <div class="vehicle-strip" role="list" aria-label="Vehicle types">
          ${vehicles.map((vehicle) => `
            <button class="vehicle-card${state.selectedVehicle === vehicle ? " selected" : ""}" type="button" data-vehicle="${vehicle}" role="listitem" aria-pressed="${state.selectedVehicle === vehicle}">
              ${vehicleShape(vehicle, "#b8b3bd")}
              <strong>${vehicle}</strong>
            </button>`).join("")}
        </div>
        <div class="sticky-footer">
          <button class="primary-button dark full" type="button" data-action="choose-color">continue with ${state.selectedVehicle}</button>
        </div>
      </div>`;
  }

  function renderColorSelection() {
    return `
      <div class="screen-light selection-layout">
        <span class="step-count">Vehicle setup · 2 of 2</span>
        <p class="eyebrow dark">One last detail</p>
        <h1>Choose its color.</h1>
        <p class="lede dark">This will make your vehicle placeholder easy to spot.</p>
        <div class="color-preview">${vehicleShape()}</div>
        <div class="swatch-grid" role="radiogroup" aria-label="Vehicle color">
          ${Object.entries(vehicleColors).map(([name, color]) => `
            <button class="swatch${state.selectedColor === name ? " selected" : ""}" type="button" data-color="${name}" style="--swatch: ${color}" role="radio" aria-checked="${state.selectedColor === name}" aria-label="${name}"></button>`).join("")}
        </div>
        <div class="sticky-footer">
          <button class="primary-button dark full" type="button" data-action="save-vehicle">save my vehicle</button>
        </div>
      </div>`;
  }

  function renderFunnel() {
    return `
      <div class="screen-purple funnel-layout">
        <div class="success-ring" aria-hidden="true">&#10003;</div>
        <p class="eyebrow">Vehicle saved</p>
        <h1>You’re all set.</h1>
        <p class="lede">You can change your vehicle type or color any time from settings.</p>
        <button class="primary-button" type="button" data-action="finish-setup">go to parking helper</button>
      </div>`;
  }

  function renderLevelSelection() {
    return `
      <div class="screen-garage">
        <div class="screen-heading compact">
          <p class="eyebrow dark">Save a location</p>
          <h1>Which level?</h1>
          <p class="lede dark">Tap a number beside the garage.</p>
        </div>
        <div class="level-layout">
          <div class="garage-side" aria-hidden="true">
            ${[6, 5, 4, 3, 2, 1].map((level) => `<div class="level-row" data-level-visual="${level}"></div>`).join("")}
          </div>
          <div class="level-numbers" aria-label="Garage levels">
            ${[1, 2, 3, 4, 5, 6].map((level) => `<button class="level-number" type="button" data-level="${level}" aria-label="Select level ${level}">${level}</button>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderZoneSelection() {
    const hasZone = Boolean(state.selectedZone);
    const hasStall = Boolean(state.selectedStall);
    return `
      <div class="screen-garage">
        <div class="screen-heading compact">
          <p class="eyebrow dark">Level ${state.selectedLevel}</p>
          <h1>${hasZone ? `Zone ${state.selectedZone} selected` : "Choose a zone."}</h1>
          <p class="lede dark">${hasZone ? "Save the zone now, or tap an outlined stall for extra detail." : "Tap the blue area where you parked."}</p>
        </div>
        <div class="garage-plan-wrap">
          ${garagePlan({ interactive: true, selectedZone: state.selectedZone, selectedStall: state.selectedStall })}
          <div class="garage-hint">${hasZone ? (hasStall ? `Stall ${state.selectedStall} selected` : "Optional: choose a stall") : "Blue outlines are parking zones"}</div>
        </div>
        ${hasZone ? `<button class="primary-button blue floating-save" type="button" data-action="save-location">${hasStall ? "save spot" : "save zone"}</button>` : ""}
      </div>`;
  }

  function renderSaveConfirmation() {
    const detail = state.selectedStall
      ? `Level ${state.selectedLevel} · Zone ${state.selectedZone} · Stall ${state.selectedStall}`
      : `Level ${state.selectedLevel} · Zone ${state.selectedZone}`;
    return `
      <div class="screen-purple funnel-layout">
        <div class="success-ring" aria-hidden="true">&#10003;</div>
        <p class="eyebrow">Location saved</p>
        <h1>Have a nice day.</h1>
        <p class="lede">${detail}</p>
        <button class="primary-button" type="button" data-action="home">back to menu</button>
      </div>`;
  }

  function currentRetrieval() {
    if (state.retrievalId) return state.history.find((item) => item.id === state.retrievalId) || null;
    return state.history[0] || null;
  }

  function renderRetrieval() {
    const location = currentRetrieval();
    if (!location) return renderEmpty("No saved spots yet", "Save a parking location first, then it will appear here.");
    return `
      <div class="screen-garage retrieve-layout">
        <div class="screen-heading compact">
          <p class="eyebrow dark">Your saved location</p>
          <h1>You are parked on level ${location.level}.</h1>
          <p class="lede dark">${location.stall ? `Zone ${location.zone}, stall ${location.stall}. Your vehicle is marked below.` : `Zone ${location.zone}. No individual stall was saved.`}</p>
        </div>
        <div class="garage-plan-wrap">
          ${garagePlan({ parkedLocation: location })}
          <div class="garage-hint">${location.stall ? `Your ${state.selectedColor} ${state.selectedVehicle}` : `Saved zone ${location.zone}`}</div>
        </div>
        <button class="primary-button dark" type="button" data-action="home">back to menu</button>
      </div>`;
  }

  function renderEmpty(title, message) {
    return `
      <div class="screen-light empty-layout">
        <div class="empty-icon" aria-hidden="true">P</div>
        <p class="eyebrow dark">Nothing here yet</p>
        <h1>${title}</h1>
        <p class="lede dark">${message}</p>
        <button class="primary-button dark" type="button" data-action="home">back to main menu</button>
      </div>`;
  }

  function renderHistory() {
    if (!state.history.length) return renderEmpty("No saved cars yet", "Your past parking locations will collect here after you save them.");
    const active = state.history.find((item) => item.id === state.activeHistoryId) || null;
    return `
      <div class="history-layout">
        <div class="history-preview">
          <div class="preview-caption">
            <p class="eyebrow dark">Past locations</p>
            <h1>${active ? `Level ${active.level} · Zone ${active.zone}` : "Choose a visit to preview it."}</h1>
          </div>
          ${garagePlan({ parkedLocation: active, preview: true })}
        </div>
        <section class="history-panel" aria-labelledby="historyTitle">
          <div class="history-panel-header">
            <h2 id="historyTitle">Parking history</h2>
            <span class="history-count">${state.history.length} saved</span>
          </div>
          <div class="history-list">
            ${state.history.map((item) => `
              <div class="history-entry">
                <button class="history-item${active && active.id === item.id ? " selected" : ""}" type="button" data-history-id="${item.id}" aria-pressed="${active && active.id === item.id}">
                  <span class="history-level">${item.level}</span>
                  <span>
                    <strong>${item.relative || item.date} · Floor ${item.level}</strong>
                    <small>Zone ${item.zone}${item.stall ? ` · Stall ${item.stall}` : " · Zone only"}</small>
                  </span>
                  <span aria-hidden="true">&#8250;</span>
                </button>
                ${active && active.id === item.id ? `<button class="history-find" type="button" data-find-history="${item.id}">Find my car</button>` : ""}
              </div>`).join("")}
          </div>
        </section>
      </div>`;
  }

  function renderAbout() {
    return `
      <div class="screen-light about-layout">
        <article class="about-card">
          <p class="eyebrow dark">About</p>
          <h1>Parking Helper</h1>
          <p class="lede dark">Project origins, contributors, GitHub details, and other information will be added here.</p>
          <div class="placeholder-lines" aria-hidden="true"><span></span><span></span><span></span></div>
        </article>
      </div>`;
  }

  function render() {
    closeSettings();
    app.classList.toggle("has-back", state.stack.length > 0 && state.screen !== "welcome");
    settingsButton.hidden = false;
    homeButton.disabled = state.screen === "warning";

    const renderers = {
      welcome: renderWelcome,
      warning: renderWarning,
      "setup-intro": renderSetupIntro,
      "vehicle-selection": renderVehicleSelection,
      "color-selection": renderColorSelection,
      funnel: renderFunnel,
      "level-selection": renderLevelSelection,
      "zone-selection": renderZoneSelection,
      confirmation: renderSaveConfirmation,
      retrieval: renderRetrieval,
      history: renderHistory,
      about: renderAbout,
    };

    screen.innerHTML = renderers[state.screen]();
    screen.focus({ preventScroll: true });
  }

  function selectStall(stallElement) {
    const zone = stallElement.closest("[data-zone]");
    if (!zone) return;

    // Stalls visually fill most of a zone, so their hitboxes must still select
    // the parent zone on the first tap. A stall becomes selectable only after
    // its zone is already active.
    if (state.selectedZone !== zone.dataset.zone) {
      state.selectedZone = zone.dataset.zone;
      state.selectedStall = null;
      render();
      return;
    }

    state.selectedStall = Number(stallElement.dataset.stall);
    render();
  }

  screen.addEventListener("click", (event) => {
    const target = event.target.closest("button, [data-stall]");
    if (!target) return;

    if (target.dataset.action) {
      const actions = {
        "warning-okay": () => navigate("setup-intro"),
        "choose-vehicle": () => navigate("vehicle-selection"),
        "choose-color": () => navigate("color-selection"),
        "save-vehicle": () => navigate("funnel"),
        "finish-setup": goHome,
        save: () => {
          state.selectedLevel = null;
          state.selectedZone = null;
          state.selectedStall = null;
          navigate("level-selection");
        },
        retrieve: () => {
          state.retrievalId = null;
          navigate("retrieval");
        },
        history: () => {
          state.activeHistoryId = null;
          navigate("history");
        },
        "save-location": () => {
          const id = `prototype-${Date.now()}`;
          state.history.unshift({
            id,
            relative: "just now",
            date: "9/2/26",
            level: state.selectedLevel,
            zone: state.selectedZone,
            stall: state.selectedStall,
          });
          state.retrievalId = id;
          navigate("confirmation");
        },
        home: goHome,
      };
      actions[target.dataset.action]?.();
      return;
    }

    if (target.dataset.findHistory) {
      state.retrievalId = target.dataset.findHistory;
      navigate("retrieval");
      return;
    }

    if (target.dataset.vehicle) {
      state.selectedVehicle = target.dataset.vehicle;
      render();
      return;
    }

    if (target.dataset.color) {
      state.selectedColor = target.dataset.color;
      render();
      return;
    }

    if (target.dataset.level) {
      state.selectedLevel = Number(target.dataset.level);
      state.selectedZone = null;
      state.selectedStall = null;
      navigate("zone-selection");
      return;
    }

    if (target.dataset.stall) {
      event.preventDefault();
      event.stopPropagation();
      selectStall(target);
      return;
    }

    const zone = target.closest("[data-zone]");
    if (zone) {
      if (state.selectedZone !== zone.dataset.zone) state.selectedStall = null;
      state.selectedZone = zone.dataset.zone;
      render();
      return;
    }

    if (target.dataset.historyId) {
      state.activeHistoryId = target.dataset.historyId;
      render();
    }
  });

  screen.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-stall]")) {
      event.preventDefault();
      selectStall(event.target);
    }
  });

  backButton.addEventListener("click", goBack);
  homeButton.addEventListener("click", () => {
    if (state.screen !== "warning") goHome();
  });

  settingsButton.addEventListener("click", () => {
    const willOpen = settingsOverlay.hidden;
    settingsOverlay.hidden = !willOpen;
    settingsButton.setAttribute("aria-expanded", String(willOpen));
  });

  settingsOverlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-settings]")) {
      closeSettings();
      return;
    }
    const action = event.target.closest("[data-settings-action]")?.dataset.settingsAction;
    if (action === "vehicle") {
      closeSettings();
      navigate("vehicle-selection");
    }
    if (action === "about") {
      closeSettings();
      navigate("about");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsOverlay.hidden) closeSettings();
  });

  window.addEventListener("popstate", () => showToast("Use the in-app back arrow in this prototype."));
  render();
})();
