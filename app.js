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
        // { id: "r4-l2-b-5", relative: "2 hours ago", date: "9/2/26", level: 2, zone: "B", stall: 5 },
        // { id: "r4-l4-d-zone", relative: null, date: "8/24/26", level: 4, zone: "D", stall: null },
        // { id: "r4-l1-a-2", relative: null, date: "7/18/26", level: 1, zone: "A", stall: 2 },
      ];

  const state = {
    screen: flags.firstTime ? "warning" : "welcome",
    stack: [],
    selectedVehicle: "Sedan",
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

  // ---------------------------------------------------------------------------
  // SUV 3D PRESENTATION — the one place to tune how the GLB looks.
  //
  // Everything in this block is applied by model-viewer in the browser at
  // runtime: edit a value, save, refresh (see "Dev refresh steps" in AGENTS.md).
  // Nothing here touches the model file.
  //
  // Things that are NOT here because they require a Blender re-export
  // (edit assets/SUV.blend, then double-click tools/export_suv.bat):
  //   - geometry, true-scale size, and pivot/origin of the car
  //   - which parts use which material, and every non-body colour
  //   - the body material's name (must match `bodyMaterial` below)
  //   - metallic / roughness of any material
  // The viewer's pixel size lives in styles.css (.vehicle-model and
  // .color-preview .vehicle-model); it is layout, not presentation.
  // ---------------------------------------------------------------------------
  const SUV_MODEL = {
    // Material whose base colour follows the chosen swatch on step 2.
    // Must equal the material name inside the GLB exactly (case-sensitive).
    bodyMaterial: "body dark purple",

    // Camera position as "yaw pitch distance". Yaw turns the car, pitch tilts
    // the view down (90deg = eye level, 0deg = straight down). Distance is in
    // metres from the model centre — a SMALLER distance makes the car LARGER
    // in the card without changing the model's true scale.
    cameraOrbit: "45deg 65.3deg 9.8m",

    // Lens angle. Narrower = larger and flatter (less perspective distortion);
    // wider = smaller with more dramatic perspective. "auto" lets model-viewer
    // choose a framing FOV, which overrides the distance above.
    fieldOfView: "24deg",

    // Point the camera looks at, as "x y z" in metres. "auto auto auto" is the
    // centre of the model's bounding box. Nudge to shift the car in the frame.
    cameraTarget: "auto auto auto",

    // Overall brightness multiplier. 1 = as-lit; try 0.8–1.3.
    exposure: "1",

    // Contact shadow under the car: 0 = none, 1 = fully opaque.
    shadowIntensity: "0.9",

    // Shadow edge blur: 0 = hard, 1 = very soft.
    shadowSoftness: "1",

    // Lighting environment. Only the two BUILT-IN names are allowed —
    // "neutral" (even, product-shot look) or "legacy" (older, warmer look).
    // Never set a URL here: the app must not make network requests.
    environmentImage: "neutral",
  };

  // URL of the SUV GLB, including its cache-busting version. The export script
  // writes assets/models/model-manifest.js; if that file is missing or fails
  // to load we still point at the plain GLB so the model never disappears.
  const SUV_MODEL_URL = (window.PARKING_HELPER_MODELS && window.PARKING_HELPER_MODELS.suv)
    || "assets/models/suv.glb";

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

  function sedanShape(view, color) {
    if (view === "rear") {
      return `
        <svg class="vehicle-art vehicle-art--sedan vehicle-art--rear" viewBox="0 0 240 160"
          style="--vehicle-color: ${color}" aria-hidden="true" focusable="false">
          <g class="vehicle-fixed-layer">
            <ellipse class="ground-shadow ground-shadow-soft" cx="121" cy="127" rx="104" ry="18" transform="rotate(9 121 127)"></ellipse>
            <ellipse class="ground-shadow" cx="121" cy="125" rx="92" ry="13" transform="rotate(9 121 125)"></ellipse>
            <g transform="rotate(10 54 57)">
              <ellipse class="tire" cx="54" cy="57" rx="16" ry="10"></ellipse>
              <ellipse class="rim" cx="54" cy="57" rx="8" ry="5"></ellipse>
              <ellipse class="hub" cx="54" cy="57" rx="3" ry="2"></ellipse>
            </g>
            <g transform="rotate(10 180 79)">
              <ellipse class="tire" cx="180" cy="79" rx="16" ry="10"></ellipse>
              <ellipse class="rim" cx="180" cy="79" rx="8" ry="5"></ellipse>
              <ellipse class="hub" cx="180" cy="79" rx="3" ry="2"></ellipse>
            </g>
          </g>
          <g class="vehicle-paint-layer">
            <path class="vehicle-paint" d="M15 70 44 51 90 57 110 37 157 41 188 61 211 69 226 92 220 112 199 126 83 121 34 102 15 85Z"></path>
            <path class="vehicle-paint" d="M124 41 157 43 178 61 160 70 121 71Z"></path>
          </g>
          <g class="vehicle-shading-layer">
            <path class="shade-light" d="M18 69 46 53 90 59 100 73 79 91 33 86 16 80Z"></path>
            <path class="shade-light" d="M126 43 156 45 175 61 159 67 123 68Z"></path>
            <path class="shade-soft" d="M95 61 111 40 124 41 121 71 101 77Z"></path>
            <path class="shade-mid" d="M33 86 79 91 221 105 220 112 199 126 83 121 34 102 15 85Z"></path>
            <path class="shade-deep" d="M34 97 84 112 209 117 199 126 83 121 34 102Z"></path>
            <path class="shade-mid" d="M198 83 211 69 226 92 220 112 199 126 194 108Z"></path>
          </g>
          <g class="vehicle-fixed-layer">
            <path class="glass" d="M95 61 111 40 124 41 121 71 102 77Z"></path>
            <path class="glass" d="M102 77 121 71 160 70 181 80 158 91 111 87Z"></path>
            <path class="glass" d="M160 70 178 61 191 66 181 80Z"></path>
            <path class="glass-glint" d="M115 80 155 77"></path>
            <path class="panel-line" d="M143 71 146 89M110 87 117 108M160 91 171 111"></path>
            <path class="panel-line" d="M190 78 211 74 222 92"></path>
            <path class="taillamp" d="M207 82 214 78 222 91 214 98 206 93Z"></path>
            <path class="taillamp-highlight" d="M210 83 214 81 218 88 214 91Z"></path>
            <path class="taillamp" d="M202 108 214 102 219 107 211 115 202 119Z"></path>
            <path class="taillamp-highlight" d="M207 108 214 105 216 108 210 112Z"></path>
            <path class="bumper" d="M200 120 220 110 218 117 200 129 193 126Z"></path>
            <path class="bumper-highlight" d="M201 120 216 112 215 116 201 124Z"></path>
            <ellipse class="wheel-well" cx="57" cy="101" rx="24" ry="17" transform="rotate(-9 57 101)"></ellipse>
            <ellipse class="wheel-well" cx="185" cy="122" rx="24" ry="17" transform="rotate(-9 185 122)"></ellipse>
            <g transform="rotate(-9 57 101)">
              <ellipse class="tire" cx="57" cy="101" rx="21" ry="14"></ellipse>
              <ellipse class="rim" cx="57" cy="101" rx="11" ry="7"></ellipse>
              <ellipse class="hub" cx="57" cy="101" rx="4" ry="3"></ellipse>
            </g>
            <g transform="rotate(-9 185 122)">
              <ellipse class="tire" cx="185" cy="122" rx="21" ry="14"></ellipse>
              <ellipse class="rim" cx="185" cy="122" rx="11" ry="7"></ellipse>
              <ellipse class="hub" cx="185" cy="122" rx="4" ry="3"></ellipse>
            </g>
          </g>
        </svg>`;
    }

    return `
      <svg class="vehicle-art vehicle-art--sedan vehicle-art--front" viewBox="0 0 240 160"
        style="--vehicle-color: ${color}" aria-hidden="true" focusable="false">
        <g class="vehicle-fixed-layer">
          <ellipse class="ground-shadow ground-shadow-soft" cx="121" cy="126" rx="104" ry="18" transform="rotate(-10 121 126)"></ellipse>
          <ellipse class="ground-shadow" cx="121" cy="124" rx="92" ry="13" transform="rotate(-10 121 124)"></ellipse>
          <g transform="rotate(-11 53 72)">
            <ellipse class="tire" cx="53" cy="72" rx="16" ry="10"></ellipse>
            <ellipse class="rim" cx="53" cy="72" rx="8" ry="5"></ellipse>
            <ellipse class="hub" cx="53" cy="72" rx="3" ry="2"></ellipse>
          </g>
          <g transform="rotate(-11 179 51)">
            <ellipse class="tire" cx="179" cy="51" rx="16" ry="10"></ellipse>
            <ellipse class="rim" cx="179" cy="51" rx="8" ry="5"></ellipse>
            <ellipse class="hub" cx="179" cy="51" rx="3" ry="2"></ellipse>
          </g>
        </g>
        <g class="vehicle-paint-layer">
          <path class="vehicle-paint" d="M15 88 45 64 92 56 110 37 157 33 190 51 211 58 226 78 220 101 87 137 36 122 15 106Z"></path>
          <path class="vehicle-paint" d="M121 39 157 34 178 51 159 60 119 69Z"></path>
        </g>
        <g class="vehicle-shading-layer">
          <path class="shade-light" d="M18 88 47 67 91 59 100 73 80 93 34 103Z"></path>
          <path class="shade-light" d="M123 40 156 36 175 51 158 57 122 66Z"></path>
          <path class="shade-soft" d="M91 59 110 39 121 39 119 69 100 73Z"></path>
          <path class="shade-mid" d="M34 103 80 93 223 72 226 78 220 101 87 137 36 122 15 106Z"></path>
          <path class="shade-deep" d="M36 115 88 129 220 95 220 101 87 137 36 122Z"></path>
          <path class="shade-mid" d="M178 51 211 58 223 75 181 72 159 60Z"></path>
        </g>
        <g class="vehicle-fixed-layer">
          <path class="glass" d="M96 58 111 40 122 39 119 68 101 75Z"></path>
          <path class="glass" d="M119 68 159 59 178 64 159 79 110 91 101 75Z"></path>
          <path class="glass" d="M159 59 178 51 190 55 178 64Z"></path>
          <path class="glass-glint" d="M113 77 153 67"></path>
          <path class="panel-line" d="M143 63 146 82M109 91 117 112M161 79 171 100"></path>
          <path class="headlamp" d="M18 87 33 78 40 80 28 92 18 95Z"></path>
          <path class="headlamp-highlight" d="M23 87 33 81 36 82 28 89Z"></path>
          <path class="headlamp" d="M17 100 32 103 40 110 27 109 17 105Z"></path>
          <path class="headlamp-highlight" d="M22 102 31 105 34 108 27 107Z"></path>
          <path class="bumper" d="M17 106 36 122 45 120 27 108Z"></path>
          <path class="bumper-highlight" d="M21 108 36 120 40 119 27 110Z"></path>
          <ellipse class="wheel-well" cx="57" cy="123" rx="24" ry="17" transform="rotate(10 57 123)"></ellipse>
          <ellipse class="wheel-well" cx="182" cy="105" rx="24" ry="17" transform="rotate(10 182 105)"></ellipse>
          <g transform="rotate(10 57 123)">
            <ellipse class="tire" cx="57" cy="123" rx="21" ry="14"></ellipse>
            <ellipse class="rim" cx="57" cy="123" rx="11" ry="7"></ellipse>
            <ellipse class="hub" cx="57" cy="123" rx="4" ry="3"></ellipse>
          </g>
          <g transform="rotate(10 182 105)">
            <ellipse class="tire" cx="182" cy="105" rx="21" ry="14"></ellipse>
            <ellipse class="rim" cx="182" cy="105" rx="11" ry="7"></ellipse>
            <ellipse class="hub" cx="182" cy="105" rx="4" ry="3"></ellipse>
          </g>
        </g>
      </svg>`;
  }

  function vehicleShape(type = state.selectedVehicle, color = vehicleColors[state.selectedColor]) {
    if (type === "Sedan") return sedanShape("front", color);
    return `<div class="vehicle-shape ${type}" style="--vehicle-color: ${color}" aria-hidden="true"></div>`;
  }

  // SUV card/preview: the CSS SUV (.vehicle-shape.SUV) is always rendered and
  // stays visible until the GLB has loaded, so the slot never renders blank.
  // `tint` is the swatch hex applied to the GLB body once it loads; when it is
  // omitted the model keeps the colour baked into the file (step-1 picker).
  function suvShape(color, { preview = false, tint = null } = {}) {
    const hostClass = `vehicle-shape SUV vehicle-model-host${preview ? " vehicle-model-host--preview" : ""}`;
    return `
      <div class="${hostClass}" style="--vehicle-color: ${color}"${tint ? ` data-tint="${tint}"` : ""} aria-hidden="true">
        <model-viewer class="vehicle-model"
          src="${SUV_MODEL_URL}"
          camera-orbit="${SUV_MODEL.cameraOrbit}"
          field-of-view="${SUV_MODEL.fieldOfView}"
          camera-target="${SUV_MODEL.cameraTarget}"
          exposure="${SUV_MODEL.exposure}"
          shadow-intensity="${SUV_MODEL.shadowIntensity}"
          shadow-softness="${SUV_MODEL.shadowSoftness}"
          environment-image="${SUV_MODEL.environmentImage}"
          interaction-prompt="none"
          loading="eager"
          tabindex="-1"
          aria-hidden="true"><div slot="progress-bar"></div></model-viewer>
      </div>`;
  }

  function suvPickerShape(color) {
    return suvShape(color);
  }

  function vehicleColorPreview() {
    const color = vehicleColors[state.selectedColor];
    if (state.selectedVehicle === "SUV") return suvShape(color, { preview: true, tint: color });
    if (state.selectedVehicle !== "Sedan") return vehicleShape();
    return `<div class="vehicle-view-pair" aria-hidden="true">${sedanShape("front", color)}${sedanShape("rear", color)}</div>`;
  }

  // CSS hex colours are sRGB-encoded; glTF baseColorFactor is LINEAR. Decode
  // each channel with the exact sRGB transfer curve before handing it to the
  // material, otherwise every car renders washed out next to its swatch.
  function srgbChannelToLinear(byte) {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }

  function hexToLinearRgba(hex) {
    let digits = String(hex).trim().replace(/^#/, "");
    if (digits.length === 3) digits = digits.split("").map((ch) => ch + ch).join("");
    const value = Number.parseInt(digits, 16);
    if (digits.length !== 6 || Number.isNaN(value)) return null;
    return [
      srgbChannelToLinear((value >> 16) & 255),
      srgbChannelToLinear((value >> 8) & 255),
      srgbChannelToLinear(value & 255),
      1,
    ];
  }

  // Recolours only the SUV body material on a loaded <model-viewer>. Every
  // other material (glass, tyres, lights, trim) is left untouched. Returns
  // false when the model or the named material isn't available.
  function tintSuvModel(viewer, hex) {
    const rgba = hexToLinearRgba(hex);
    const materials = viewer && viewer.model ? viewer.model.materials : null;
    if (!rgba || !materials) return false;
    const body = materials.find((material) => material.name === SUV_MODEL.bodyMaterial);
    if (!body) return false;
    try {
      body.pbrMetallicRoughness.setBaseColorFactor(rgba);
      return true;
    } catch {
      return false;
    }
  }

  function initializeVehicleModels() {
    let supportsWebGL = false;
    try {
      const canvas = document.createElement("canvas");
      supportsWebGL = Boolean(
        window.WebGLRenderingContext
          && (canvas.getContext("webgl2") || canvas.getContext("webgl")),
      );
    } catch {
      supportsWebGL = false;
    }

    screen.querySelectorAll(".vehicle-model-host").forEach((host) => {
      const viewer = host.querySelector("model-viewer");
      if (!viewer) return;
      if (!supportsWebGL) {
        viewer.removeAttribute("src");
        return;
      }

      // Tint first, then reveal, so the baked-in body colour never flashes.
      // The tint is read at load time (not render time) so a swatch tapped
      // while the GLB is still downloading is honoured as well.
      const showModel = () => {
        if (host.dataset.tint && !tintSuvModel(viewer, host.dataset.tint)) {
          host.classList.remove("model-ready");
          return; // body material missing: keep the tinted flat fallback
        }
        host.classList.add("model-ready");
      };
      const showFallback = () => host.classList.remove("model-ready");
      viewer.addEventListener("load", showModel, { once: true });
      viewer.addEventListener("error", showFallback);
      if (viewer.loaded) showModel();
    });
  }

  // Re-tints the step-2 SUV preview without rebuilding the screen, so the 3D
  // model is not destroyed and re-downloaded on every swatch tap. Returns false
  // when there is no SUV preview on screen; the caller then falls back to the
  // full render() exactly as before. State and navigation are not touched.
  function applyColorInPlace() {
    if (state.screen !== "color-selection") return false;
    const host = screen.querySelector(".color-preview .vehicle-model-host");
    if (!host) return false;

    const color = vehicleColors[state.selectedColor];
    host.style.setProperty("--vehicle-color", color); // flat fallback tint
    host.dataset.tint = color; // picked up by the load handler if still loading
    const viewer = host.querySelector("model-viewer");
    if (viewer && host.classList.contains("model-ready") && !tintSuvModel(viewer, color)) {
      host.classList.remove("model-ready");
    }

    screen.querySelectorAll(".swatch[data-color]").forEach((swatch) => {
      const selected = swatch.dataset.color === state.selectedColor;
      swatch.classList.toggle("selected", selected);
      swatch.setAttribute("aria-checked", String(selected));
    });
    return true;
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
          <button class="primary-button" type="button" data-action="retrieve">Find my car</button>
          <button class="primary-button" type="button" data-action="save">Save where you parked</button>
          <button class="text-button" type="button" data-action="history">See my past vehicle locations</button>
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
        <button class="primary-button bottom-action full" type="button" data-action="warning-okay">I Understand</button>
      </div>`;
  }

  function renderSetupIntro() {
    return `
      <div class="screen-purple intro-layout">
        <div class="intro-icon" aria-hidden="true"></div>
        <p class="eyebrow">Welcome</p>
        <h1>Setup</h1>
        <p class="lede" style="margin-inline: auto">Let's start by selecting your vehicle</p>
        <button class="primary-button" type="button" data-action="choose-vehicle">Continue</button>
      </div>`;
  }

  function renderVehicleSelection() {
    const vehicles = ["Sedan", "SUV", "Truck", "Motorcycle"];
    return `
      <div class="screen-light selection-layout">
        <span class="step-count">Vehicle setup · 1 of 2</span>
        <p class="eyebrow dark">Make it recognizable</p>
        <h1>What do you drive?</h1>
        <p class="lede dark">Swipe through the shapes and choose the closest match.</p>
        <div class="vehicle-strip" role="list" aria-label="Vehicle types">
          ${vehicles.map((vehicle) => `
            <button class="vehicle-card${state.selectedVehicle === vehicle ? " selected" : ""}" type="button" data-vehicle="${vehicle}" role="listitem" aria-pressed="${state.selectedVehicle === vehicle}">
              ${vehicle === "SUV" ? suvPickerShape("#b8b3bd") : vehicleShape(vehicle, "#b8b3bd")}
              <strong>${vehicle}</strong>
            </button>`).join("")}
        </div>
        <div class="sticky-footer">
          <button class="primary-button dark full" type="button" data-action="choose-color">Continue with ${state.selectedVehicle}</button>
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
        <div class="color-preview">${vehicleColorPreview()}</div>
        <div class="swatch-grid" role="radiogroup" aria-label="Vehicle color">
          ${Object.entries(vehicleColors).map(([name, color]) => `
            <button class="swatch${state.selectedColor === name ? " selected" : ""}" type="button" data-color="${name}" style="--swatch: ${color}" role="radio" aria-checked="${state.selectedColor === name}" aria-label="${name}"></button>`).join("")}
        </div>
        <div class="sticky-footer">
          <button class="primary-button dark full" type="button" data-action="save-vehicle">Save my vehicle</button>
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
        <button class="primary-button" type="button" data-action="finish-setup">Return to parking helper</button>
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
        ${hasZone ? `<button class="primary-button blue floating-save" type="button" data-action="save-location">${hasStall ? "Save spot" : "Save zone"}</button>` : ""}
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
        <button class="primary-button" type="button" data-action="home">Back to menu</button>
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
        <button class="primary-button dark" type="button" data-action="home">Back to menu</button>
      </div>`;
  }

  function renderEmpty(title, message) {
    return `
      <div class="screen-light empty-layout">
        <div class="empty-icon" aria-hidden="true">P</div>
        <p class="eyebrow dark">Nothing here yet</p>
        <h1>${title}</h1>
        <p class="lede dark">${message}</p>
        <button class="primary-button dark" type="button" data-action="home">Back to main menu</button>
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
    initializeVehicleModels();
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
            relative: "Just now",
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
      if (!applyColorInPlace()) render();
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
  if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker.register("./service-worker.js").catch(() => {});
      },
      { once: true },
    );
  }
  render();
})();
