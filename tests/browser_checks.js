/* Run against the served page with: agent-browser eval --stdin < tests/browser_checks.js */
(async () => {
  const checks = [];
  const get = (selector) => document.querySelector(selector);
  const assert = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const change = (selector, value) => {
    const node = get(selector);
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const click = (selector) => get(selector).click();
  const text = (selector) => get(selector).textContent;
  click("#reset");
  assert(!get("#explorer").hidden && get("#load-status").hidden, "Data loaded");
  assert(
    text("#day-count") === "264 days selected",
    "Full date range is inclusive",
  );
  assert(
    text("#stats").includes("69.9°") && text("#stats").includes("91.4°"),
    "Default mean highs match independently computed CSV values",
  );
  assert(
    text("#stats").includes("32.19") && text("#stats").includes("4.74"),
    "Default precipitation sums match CSV values",
  );
  click('[data-season="summer"]');
  assert(
    get("#start-date").value === "2017-06-01" &&
      get("#end-date").value === "2017-08-31",
    "Summer synchronizes date inputs",
  );
  assert(text("#day-count") === "92 days selected", "Summer has 92 days");
  const summerTicks = Array.from(
    document.querySelectorAll("#temperature-chart .axis .tick text"),
    (node) => node.textContent,
  );
  assert(
    new Set(summerTicks).size === summerTicks.length,
    "Summer month labels are unique",
  );
  click('[data-metric="tmin"]');
  assert(
    text("#temp-caption").includes("Daily low") &&
      text("#stats").includes("Mean daily low"),
    "Low-temperature switch updates chart and summaries",
  );
  click("#try-pair");
  assert(
    get("#state-a").value === "WA" && text("#legend").includes("Seattle"),
    "Narrative preset changes station and retains linked controls",
  );
  change("#inspect-date", "2017-07-04");
  const before = get("#inspect-date").value;
  get("#temperature-chart").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert(
    before === "2017-07-04" && get("#inspect-date").value === "2017-07-05",
    "Keyboard moves daily details",
  );
  const invalidRange = text("#range-label");
  change("#start-date", "2017-09-01");
  assert(
    text("#date-error").length > 0 && text("#range-label") === invalidRange,
    "Reversed dates show error and preserve valid chart",
  );
  click("#reset");
  change("#start-date", "2017-09-21");
  assert(text("#day-count") === "1 day selected", "Single-day range works");
  assert(
    get("#temperature-chart .axis").querySelectorAll(".tick").length === 1,
    "Single-day chart has one unambiguous date tick",
  );
  change("#inspect-date", "2017-12-31");
  assert(
    get("#inspect-date").value === "2017-09-21",
    "Daily date picker clamps out-of-range dates",
  );
  assert(
    !get("#temperature-chart").innerHTML.includes("NaN") &&
      !get("#rain-chart").innerHTML.includes("NaN"),
    "Single-day chart geometry is finite",
  );
  click("#reset");
  // Drive D3's real mouse handlers, rather than directly changing application state.
  const overlay = get("#overview-chart .overlay");
  const box = overlay.getBoundingClientRect();
  const x1 = box.left + box.width * 0.3,
    x2 = box.left + box.width * 0.6,
    y = box.top + box.height / 2;
  overlay.dispatchEvent(
    new MouseEvent("mousedown", {
      view: window,
      bubbles: true,
      clientX: x1,
      clientY: y,
      buttons: 1,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", {
      view: window,
      bubbles: true,
      clientX: x2,
      clientY: y,
      buttons: 1,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      view: window,
      bubbles: true,
      clientX: x2,
      clientY: y,
      buttons: 0,
    }),
  );
  assert(
    get("#start-date").value > "2017-01-01" &&
      get("#end-date").value < "2017-09-21",
    "Brush updates both date bounds",
  );
  assert(
    get("#temperature-chart .temperature-line").getAttribute("d").length > 0,
    "Temperature redraws after brushing",
  );
  assert(
    get("#rain-chart svg rect").getAttribute("width") !== null,
    "Precipitation redraws after brushing",
  );
  const target = get("#temperature-chart .interaction-overlay");
  const bounds = target.getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + 20,
    }),
  );
  const cursorA = get("#temperature-chart .cursor-line").getAttribute("x1");
  const cursorB = get("#rain-chart .cursor-line").getAttribute("x1");
  assert(cursorA === cursorB, "Hover links the same date across charts");
  // Verify a source row known to contain no readings, not an invented mock station.
  const metadata = await (await fetch("data/stations.json")).json();
  const missing = metadata.find((s) => s.id === "00454e0ed234");
  change("#state-a", missing.state);
  change("#station-a", missing.id);
  click("#reset-range");
  change("#start-date", "2017-09-18");
  change("#end-date", "2017-09-18");
  assert(
    get("#daily-details > div").textContent.includes(
      "High missing · Low missing · Precip. missing",
    ),
    "Missing readings are not coerced to zeros",
  );
  assert(
    text("#coverage-body").includes("0 / 1"),
    "Coverage exposes missing readings",
  );
  change("#state-b", missing.state);
  change("#station-b", missing.id);
  assert(
    text("#temperature-chart").includes("No readings") &&
      text("#rain-chart").includes("No readings"),
    "Empty selection charts explain missing data",
  );
  // Capture only the download transport; generation still uses the real selection.
  let captured;
  const originalURL = URL.createObjectURL,
    originalClick = HTMLAnchorElement.prototype.click;
  try {
    URL.createObjectURL = (blob) => {
      captured = blob;
      return originalURL(blob);
    };
    HTMLAnchorElement.prototype.click = function () {};
    click("#download");
  } finally {
    URL.createObjectURL = originalURL;
    HTMLAnchorElement.prototype.click = originalClick;
  }
  const csv = await captured.text();
  assert(
    csv.includes("tmin_f_inferred") &&
      csv.split("\n").length === 3 &&
      csv.includes("2017-09-18,,,"),
    "Export has both station slots and preserves missing cells",
  );
  click("#reset");
  assert(
    get("#state-a").value === "MD" &&
      get("#state-b").value === "AZ" &&
      text("#day-count") === "264 days selected",
    "Reset restores both stations and full range",
  );
  assert(
    get('[data-metric="tmax"]').getAttribute("aria-pressed") === "true",
    "Reset restores temperature encoding",
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    "Page has no horizontal overflow",
  );
  return { passed: checks.length, checks };
})();
