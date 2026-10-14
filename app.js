/* Shared selection state links all D3 views. No server or build step required. */
"use strict";

const DAY = 86400000;
const COLORS = ["#b95832", "#167875"];
const DEFAULT_IDS = ["596ff9d4d6f9", "117d3cbd20fd"];
const stateNames = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};
const $ = (selector) => document.querySelector(selector);
const dateISO = (value) => new Date(value).toISOString().slice(0, 10);
const dateLabel = (value) => d3.utcFormat("%b %-d")(new Date(value));
const numeric = (value) => (value === "" ? null : Number(value));
const present = (value) =>
  value !== null && value !== undefined && Number.isFinite(value);
const fmt = (value, digits = 1, suffix = "") =>
  present(value) ? `${value.toFixed(digits)}${suffix}` : "n/a";
const shortName = (station) =>
  station.name
    .replace(/ INTL AP$/, " Intl.")
    .replace(/ AP$/, " Airport")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
const records = new Map();
let stations, stationById, extent, fullDays, brush, brushGroup, overviewX;
let selectedIds = [...DEFAULT_IDS];
let range,
  inspected,
  metric = "tmax",
  charts = [],
  resizeTimer;

function stationSeries(id, days) {
  const byDate = records.get(id);
  return days.map(
    (date) => byDate?.get(date) || { date, tmin: null, tmax: null, prcp: null },
  );
}

function daysInRange() {
  return d3.utcDay
    .range(new Date(range[0]), new Date(range[1] + DAY))
    .map(Number);
}

function currentStations() {
  return selectedIds.map((id) => stationById.get(id));
}

function populateStations(slot, stateCode, preferred) {
  const select = $(`#station-${slot}`);
  const options = stations.filter((s) => s.state === stateCode);
  select.replaceChildren(...options.map((s) => new Option(shortName(s), s.id)));
  select.value = options.some((s) => s.id === preferred)
    ? preferred
    : options[0].id;
  selectedIds[slot === "a" ? 0 : 1] = select.value;
}

function syncStationControls() {
  ["a", "b"].forEach((slot, i) => {
    const station = stationById.get(selectedIds[i]);
    $(`#state-${slot}`).value = station.state;
    populateStations(slot, station.state, station.id);
  });
}

function setRange(start, end, syncBrush = true) {
  range = [
    Math.max(extent[0], Math.min(start, extent[1])),
    Math.max(extent[0], Math.min(end, extent[1])),
  ];
  if (range[0] > range[1]) range.reverse();
  inspected = Math.max(range[0], Math.min(inspected ?? range[0], range[1]));
  $("#start-date").value = dateISO(range[0]);
  $("#end-date").value = dateISO(range[1]);
  $("#inspect-date").min = dateISO(range[0]);
  $("#inspect-date").max = dateISO(range[1]);
  $("#date-error").textContent = "";
  document.querySelectorAll("[data-season]").forEach((button) => {
    const dates = seasonRange(button.dataset.season);
    button.setAttribute(
      "aria-pressed",
      dates[0] === range[0] && dates[1] === range[1],
    );
  });
  render();
  if (syncBrush && brushGroup)
    brushGroup.call(brush.move, [
      overviewX(range[0] - DAY / 2),
      overviewX(range[1] + DAY / 2),
    ]);
}

function seasonRange(season) {
  const dates = {
    winter: ["2017-01-01", "2017-02-28"],
    spring: ["2017-03-01", "2017-05-31"],
    summer: ["2017-06-01", "2017-08-31"],
    fall: ["2017-09-01", "2017-09-21"],
  };
  return dates[season]
    ? dates[season].map((d) => Date.parse(d + "T00:00:00Z"))
    : [...extent];
}

function summarize(series) {
  const temperatures = series.map((d) => d[metric]).filter(present);
  const precipitation = series.map((d) => d.prcp).filter(present);
  return {
    mean: d3.mean(temperatures),
    tempCount: temperatures.length,
    total: precipitation.length ? d3.sum(precipitation) : null,
    rainCount: precipitation.length,
    wet: precipitation.length
      ? precipitation.filter((p) => p >= 0.01).length
      : null,
  };
}

function renderStats(series, days) {
  const summaries = series.map(summarize);
  const metrics = [
    {
      label: `Mean daily ${metric === "tmax" ? "high" : "low"}`,
      values: summaries.map((s) => fmt(s.mean, 1, "°")),
      note: "°F · available observations",
    },
    {
      label: "Total precipitation",
      values: summaries.map((s) => fmt(s.total, 2)),
      note: "inches · observed days only",
    },
    {
      label: "Days with precipitation",
      values: summaries.map((s) => fmt(s.wet, 0)),
      note: "days with at least 0.01 inches",
    },
  ];
  $("#stats").innerHTML = metrics
    .map(
      (m) =>
        `<div class="stat"><p class="stat-label">${m.label}</p><p class="stat-value"><span class="a">${m.values[0]}</span><span class="versus">/</span><span class="b">${m.values[1]}</span></p><p class="stat-note">${m.note}</p></div>`,
    )
    .join("");
  const body = $("#coverage-body");
  body.replaceChildren();
  currentStations().forEach((station, i) => {
    const summary = summaries[i];
    const tr = document.createElement("tr");
    const values = [
      `${i === 0 ? "A" : "B"} · ${shortName(station)}, ${station.state}`,
      fmt(summary.mean, 1, " °F"),
      `${summary.tempCount} / ${days.length}`,
      fmt(summary.total, 2, " in"),
      `${summary.rainCount} / ${days.length}`,
      fmt(summary.wet, 0),
    ];
    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    body.append(tr);
  });
  // Compare paired dates so unequal measurement coverage does not bias this claim.
  const differences = series[0].flatMap((row, i) =>
    present(row[metric]) && present(series[1][i][metric])
      ? [row[metric] - series[1][i][metric]]
      : [],
  );
  const delta = d3.mean(differences);
  const selected = currentStations();
  const coverage = summaries.some(
    (s) => s.tempCount < days.length || s.rainCount < days.length,
  );
  $("#insight").textContent = present(delta)
    ? `${shortName(selected[0])} had ${Math.abs(delta).toFixed(1)}°F ${delta >= 0 ? "higher" : "lower"} daily ${metric === "tmax" ? "highs" : "lows"} on average than ${shortName(selected[1])}, across ${differences.length} days with readings at both stations.${coverage ? " Some readings are missing, so check observation coverage." : ""}`
    : "These stations have no overlapping temperature readings in this date range. Try another station or a wider range.";
}

function createChart(selector, series, isRain) {
  const container = $(selector);
  const width = Math.max(280, container.clientWidth);
  const height = isRain ? 170 : 235;
  const margin = { left: 40, right: 10, top: 16, bottom: 28 };
  const bottom = height - margin.bottom;
  const x = d3
    .scaleUtc()
    .domain([range[0] - DAY / 2, range[1] + DAY / 2])
    .range([margin.left, width - margin.right]);
  const field = isRain ? "prcp" : metric;
  const values = series
    .flatMap((rows) => rows.map((row) => row[field]))
    .filter(present);
  let domain = isRain ? [0, d3.max(values) || 1] : d3.extent(values);
  if (!values.length) domain = isRain ? [0, 1] : [0, 100];
  if (!isRain) domain = [domain[0] - 5, domain[1] + 5];
  const y = d3.scaleLinear().domain(domain).nice().range([bottom, margin.top]);
  const svg = d3
    .select(container)
    .selectAll("svg")
    .data([null])
    .join("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  svg
    .append("title")
    .text(
      isRain
        ? "Daily precipitation in inches for two selected stations"
        : `Daily ${metric === "tmax" ? "high" : "low"} temperature in degrees Fahrenheit for two selected stations`,
    );
  svg
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickSize(-(width - margin.left - margin.right))
        .tickPadding(8),
    );
  const tickCount = Math.max(2, Math.floor((width - 50) / 85));
  const timeAxis = d3
    .axisBottom(x)
    .ticks(tickCount)
    .tickFormat(d3.utcFormat(range[1] - range[0] > 80 * DAY ? "%b" : "%b %-d"))
    .tickSize(0)
    .tickPadding(10);
  if (range[1] - range[0] <= 2 * DAY)
    timeAxis.tickValues(daysInRange().map((date) => new Date(date)));
  else if (range[1] - range[0] > 80 * DAY)
    timeAxis.ticks(
      d3.utcMonth.every(
        Math.max(1, Math.round((range[1] - range[0]) / (30 * DAY) / tickCount)),
      ),
    );
  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${bottom})`)
    .call(timeAxis);
  if (!isRain && y.domain()[0] < 32 && y.domain()[1] > 32) {
    svg
      .append("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", y(32))
      .attr("y2", y(32))
      .attr("stroke", "#acb7a9")
      .attr("stroke-dasharray", "3 4");
    svg
      .append("text")
      .attr("x", width - margin.right - 3)
      .attr("y", y(32) - 4)
      .attr("text-anchor", "end")
      .attr("fill", "#647368")
      .attr("font-size", 9)
      .text("32°F · freezing");
  }
  if (isRain) {
    const dayWidth = (width - margin.left - margin.right) / series[0].length;
    const barWidth = Math.max(0.4, dayWidth * 0.4);
    series.forEach((rows, i) => {
      svg
        .append("g")
        .attr("fill", COLORS[i])
        .attr("fill-opacity", 0.82)
        .selectAll("rect")
        .data(rows.filter((d) => present(d.prcp)))
        .join("rect")
        .attr("x", (d) => x(d.date) + (i === 0 ? -barWidth : 0))
        .attr("y", (d) => y(d.prcp))
        .attr("width", barWidth)
        .attr("height", (d) => bottom - y(d.prcp));
    });
  } else {
    const line = d3
      .line()
      .defined((d) => present(d[metric]))
      .x((d) => x(d.date))
      .y((d) => y(d[metric]));
    series.forEach((rows, i) => {
      svg
        .append("path")
        .datum(rows)
        .attr("class", "temperature-line")
        .attr("fill", "none")
        .attr("stroke", COLORS[i])
        .attr("stroke-width", 1.8)
        .attr("stroke-dasharray", i ? "5 3" : null)
        .attr("d", line);
      // Individual points remain visible when a reading has missing neighbors.
      svg
        .append("g")
        .attr("fill", COLORS[i])
        .selectAll("circle")
        .data(rows.filter((d) => present(d[metric])))
        .join("circle")
        .attr("cx", (d) => x(d.date))
        .attr("cy", (d) => y(d[metric]))
        .attr("r", rows.length < 35 ? 2.5 : 1.2);
    });
  }
  if (!values.length)
    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#657168")
      .attr("font-size", 12)
      .text("No readings in this range");
  const cursor = svg
    .append("g")
    .attr("class", "cursor")
    .attr("pointer-events", "none");
  cursor
    .append("line")
    .attr("class", "cursor-line")
    .attr("y1", margin.top)
    .attr("y2", bottom);
  if (!isRain)
    cursor
      .selectAll("circle")
      .data([0, 1])
      .join("circle")
      .attr("r", 4)
      .attr("fill", (i) => COLORS[i])
      .attr("stroke", "#fffefa")
      .attr("stroke-width", 2);
  svg
    .append("rect")
    .attr("class", "interaction-overlay")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", width - margin.left - margin.right)
    .attr("height", bottom - margin.top)
    .attr("fill", "transparent")
    .on("pointermove pointerdown", function (event) {
      const [position] = d3.pointer(event, this);
      inspect(
        Math.max(
          range[0],
          Math.min(range[1], Math.round(+x.invert(position) / DAY) * DAY),
        ),
      );
    });
  charts.push({ cursor, x, y, isRain });
}

function renderOverview() {
  const width = Math.max(280, $("#overview-chart").clientWidth),
    height = 70;
  overviewX = d3
    .scaleUtc()
    .domain([extent[0] - DAY / 2, extent[1] + DAY / 2])
    .range([40, width - 10]);
  const series = selectedIds.map((id) => stationSeries(id, fullDays));
  const values = series
    .flatMap((rows) => rows.map((row) => row[metric]))
    .filter(present);
  let domain = d3.extent(values);
  if (!values.length) domain = [0, 100];
  if (domain[0] === domain[1]) domain = [domain[0] - 5, domain[1] + 5];
  const y = d3.scaleLinear().domain(domain).range([45, 5]);
  const svg = d3
    .select("#overview-chart")
    .selectAll("svg")
    .data([null])
    .join("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const line = d3
    .line()
    .defined((d) => present(d[metric]))
    .x((d) => overviewX(d.date))
    .y((d) => y(d[metric]));
  series.forEach((rows, i) =>
    svg
      .append("path")
      .datum(rows)
      .attr("fill", "none")
      .attr("stroke", COLORS[i])
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-dasharray", i ? "4 2" : null)
      .attr("d", line),
  );
  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", "translate(0,49)")
    .call(
      d3
        .axisBottom(overviewX)
        .ticks(Math.max(3, Math.floor(width / 85)))
        .tickFormat(d3.utcFormat("%b"))
        .tickSize(0)
        .tickPadding(8),
    );
  brush = d3
    .brushX()
    .extent([
      [40, 0],
      [width - 10, 49],
    ])
    .on("brush end", (event) => {
      if (!event.sourceEvent) return; // Ignore programmatic synchronization.
      if (!event.selection) {
        setRange(...extent);
        return;
      }
      const [left, right] = event.selection.map(overviewX.invert).map(Number);
      const first = Math.round((left + DAY / 2) / DAY) * DAY;
      const last = Math.max(first, Math.round((right - DAY / 2) / DAY) * DAY);
      const nextStart = Math.max(extent[0], Math.min(first, extent[1]));
      const nextEnd = Math.max(extent[0], Math.min(last, extent[1]));
      if (nextStart !== range[0] || nextEnd !== range[1])
        setRange(nextStart, nextEnd, false);
      if (event.type === "end")
        brushGroup.call(brush.move, [
          overviewX(range[0] - DAY / 2),
          overviewX(range[1] + DAY / 2),
        ]);
    });
  brushGroup = svg.append("g").attr("class", "brush").call(brush);
  brushGroup.call(brush.move, [
    overviewX(range[0] - DAY / 2),
    overviewX(range[1] + DAY / 2),
  ]);
}

function inspect(date, force = false) {
  if (date === inspected && !force) return;
  inspected = date;
  $("#inspect-date").value = dateISO(date);
  const details = $("#daily-details");
  details.replaceChildren();
  currentStations().forEach((station, i) => {
    const row = records.get(station.id)?.get(date);
    const section = document.createElement("div");
    const heading = document.createElement("p");
    heading.className = `daily-station ${i ? "b" : "a"}`;
    heading.textContent = `${i ? "B" : "A"} · ${shortName(station)}`;
    const values = document.createElement("p");
    values.className = "daily-values";
    const reading = (field, suffix, digits) =>
      present(row?.[field]) ? `${fmt(row[field], digits)}${suffix}` : "missing";
    values.textContent = `High ${reading("tmax", "°F", 1)} · Low ${reading("tmin", "°F", 1)} · Precip. ${reading("prcp", " in", 2)}`;
    section.append(heading, values);
    details.append(section);
  });
  charts.forEach((chart) => {
    const position = chart.x(date);
    chart.cursor.select("line").attr("x1", position).attr("x2", position);
    chart.cursor
      .selectAll("circle")
      .attr("cx", position)
      .attr("cy", (i) => {
        const value = records.get(selectedIds[i])?.get(date)?.[metric];
        return present(value) ? chart.y(value) : 0;
      })
      .attr("display", (i) =>
        present(records.get(selectedIds[i])?.get(date)?.[metric])
          ? null
          : "none",
      );
  });
}

function render() {
  const days = daysInRange();
  const series = selectedIds.map((id) => stationSeries(id, days));
  $("#range-label").textContent =
    `${dateLabel(range[0])} – ${dateLabel(range[1])}, 2017`;
  $("#day-count").textContent =
    `${days.length} ${days.length === 1 ? "day" : "days"} selected`;
  $("#temp-caption").textContent =
    `Daily ${metric === "tmax" ? "high" : "low"} temperature · °F`;
  const legend = $("#legend");
  legend.replaceChildren();
  currentStations().forEach((station, i) => {
    const item = document.createElement("span");
    item.className = `legend-item ${i ? "b" : "a"}`;
    const swatch = document.createElement("span");
    swatch.className = "line-sample";
    swatch.setAttribute("aria-hidden", "true");
    item.append(
      swatch,
      `${i ? "B" : "A"} · ${shortName(station)}, ${station.state}`,
    );
    legend.append(item);
    $(`#coords-${i ? "b" : "a"}`).textContent =
      `${Math.abs(station.latitude).toFixed(2)}°${station.latitude >= 0 ? "N" : "S"}  ${Math.abs(station.longitude).toFixed(2)}°${station.longitude >= 0 ? "E" : "W"}`;
  });
  renderStats(series, days);
  charts = [];
  createChart("#temperature-chart", series, false);
  createChart("#rain-chart", series, true);
  inspect(inspected, true);
}

function exportSelection() {
  const rows = [];
  currentStations().forEach((station, i) => {
    for (const row of stationSeries(station.id, daysInRange())) {
      rows.push({
        slot: i ? "B" : "A",
        station_id: station.id,
        station: station.name,
        state: station.state,
        date: dateISO(row.date),
        tmin_f_inferred: row.tmin,
        tmax_f_inferred: row.tmax,
        prcp_in_inferred: row.prcp,
      });
    }
  });
  const url = URL.createObjectURL(
    new Blob([d3.csvFormat(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `weather-selection-${dateISO(range[0])}-${dateISO(range[1])}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireControls() {
  const availableStates = [...new Set(stations.map((s) => s.state))].sort(
    (a, b) => stateNames[a].localeCompare(stateNames[b]),
  );
  ["a", "b"].forEach((slot) => {
    const select = $(`#state-${slot}`);
    select.replaceChildren(
      ...availableStates.map(
        (code) => new Option(`${stateNames[code]} (${code})`, code),
      ),
    );
    select.addEventListener("change", () => {
      populateStations(slot, select.value);
      render();
      renderOverview();
    });
    $(`#station-${slot}`).addEventListener("change", (event) => {
      selectedIds[slot === "a" ? 0 : 1] = event.target.value;
      render();
      renderOverview();
    });
  });
  document
    .querySelectorAll("[data-season]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setRange(...seasonRange(button.dataset.season)),
      ),
    );
  document.querySelectorAll("[data-metric]").forEach((button) =>
    button.addEventListener("click", () => {
      if (metric === button.dataset.metric) return;
      metric = button.dataset.metric;
      document
        .querySelectorAll("[data-metric]")
        .forEach((b) => b.setAttribute("aria-pressed", b === button));
      render();
      renderOverview();
    }),
  );
  ["#start-date", "#end-date"].forEach((selector) =>
    $(selector).addEventListener("change", () => {
      const start = Date.parse($("#start-date").value + "T00:00:00Z");
      const end = Date.parse($("#end-date").value + "T00:00:00Z");
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > end ||
        start < extent[0] ||
        end > extent[1]
      ) {
        $("#date-error").textContent =
          "Choose dates from Jan 1 to Sep 21, with the start on or before the end.";
        return;
      }
      setRange(start, end);
    }),
  );
  $("#inspect-date").addEventListener("change", (event) => {
    const value = Date.parse(event.target.value + "T00:00:00Z");
    if (Number.isFinite(value))
      inspect(Math.max(range[0], Math.min(value, range[1])), true);
    else event.target.value = dateISO(inspected);
  });
  ["#temperature-chart", "#rain-chart"].forEach((selector) =>
    $(selector).addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        inspect(
          Math.max(
            range[0],
            Math.min(
              range[1],
              inspected + (event.key === "ArrowRight" ? DAY : -DAY),
            ),
          ),
        );
      }
    }),
  );
  $("#reset-range").addEventListener("click", () => setRange(...extent));
  $("#reset").addEventListener("click", () => {
    selectedIds = [...DEFAULT_IDS];
    metric = "tmax";
    syncStationControls();
    document
      .querySelectorAll("[data-metric]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", b.dataset.metric === metric),
      );
    inspected = extent[0];
    setRange(...extent);
    renderOverview();
  });
  $("#try-pair").addEventListener("click", () => {
    selectedIds = ["4f5a5a647850", "117d3cbd20fd"];
    syncStationControls();
    setRange(...seasonRange("summer"));
    renderOverview();
  });
  $("#download").addEventListener("click", exportSelection);
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      render();
      renderOverview();
    }, 100);
  });
}

async function initialize() {
  try {
    if (typeof d3 === "undefined")
      throw new Error("The local D3 library could not be loaded.");
    const dates = new Map();
    const result = await Promise.all([
      d3.json("data/stations.json"),
      d3.json("data/cleaning_report.json"),
      d3.csv("data/weather_clean.csv", (row) => {
        if (!dates.has(row.date))
          dates.set(row.date, Date.parse(row.date + "T00:00:00Z"));
        if (!records.has(row.station_id))
          records.set(row.station_id, new Map());
        const date = dates.get(row.date);
        records.get(row.station_id).set(date, {
          date,
          tmin: numeric(row.tmin),
          tmax: numeric(row.tmax),
          prcp: numeric(row.prcp),
        });
        return null; // Store once in the station index, not in a second CSV array.
      }),
    ]);
    stations = result[0];
    stationById = new Map(stations.map((s) => [s.id, s]));
    const report = result[1];
    extent = [report.date_start, report.date_end].map((d) =>
      Date.parse(d + "T00:00:00Z"),
    );
    fullDays = d3.utcDay
      .range(new Date(extent[0]), new Date(extent[1] + DAY))
      .map(Number);
    selectedIds = DEFAULT_IDS.map((id, i) =>
      stationById.has(id) ? id : stations[i % stations.length].id,
    );
    range = [...extent];
    inspected = extent[0];
    $("#explorer").hidden = false;
    $("#load-status").hidden = true;
    wireControls();
    syncStationControls();
    setRange(...extent);
    renderOverview();
  } catch (error) {
    console.error(error);
    $("#load-status").hidden = false;
    $("#load-status").textContent =
      "The weather data could not be loaded. Run “python3 -m http.server 8000” in the project folder and open http://localhost:8000. On a hosted site, check that the data and vendor folders were uploaded, then reload.";
    $("#load-status").setAttribute("role", "alert");
    $("#explorer").hidden = true;
  }
}

initialize();
