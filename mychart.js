// Charts on the landing page (Chart.js 3).
//
// Each chart is drawn when its card scrolls into view, in the colors of the
// current light or dark scheme, and redrawn when the reader switches schemes.
// The series colors are validated for color-vision deficiency in both
// schemes; every chart also has a legend or labels, and a data table.

(function () {
  'use strict';
  if (!window.Chart) return;

  // Colors follow the entity: LRU is blue and S3-FIFO is orange everywhere
  var SERIES = {
    light: {
      FIFO: '#e87ba4', LRU: '#2a78d6', TinyLFU: '#1baf7a', 'S3-FIFO': '#f27b00',
      Zipf: '#008300', MSR: '#6250d6', Twitter: '#eda100'
    },
    dark: {
      FIFO: '#d55181', LRU: '#3987e5', TinyLFU: '#199e70', 'S3-FIFO': '#e07000',
      Zipf: '#008300', MSR: '#9085e9', Twitter: '#c98500'
    }
  };

  var DATA = {
    'chart-miss': {
      type: 'bar',
      labels: ['Meta', 'Twitter', 'Wikimedia', 'Tencent', 'CDN'],
      series: {
        FIFO: [0.0938, 0.0574, 0.1087, 0.0967, 0.0767],
        LRU: [0.0812, 0.0488, 0.0803, 0.0659, 0.0688],
        TinyLFU: [0.0853, 0.0445, 0.0605, 0.0715, 0.0656],
        'S3-FIFO': [0.0755, 0.0424, 0.0629, 0.0551, 0.0622]
      },
      fmt: function (v) { return v.toFixed(3); },
      head: ['Dataset']
    },
    // Cache size S3-FIFO needs relative to LRU for a 10% miss ratio, shown as
    // the share of LRU's cache it saves
    'chart-size': {
      type: 'hbar',
      labels: ['Meta', 'Twitter', 'Wikimedia', 'Alibaba', 'Tencent', 'CDN1', 'CDN2'],
      series: {
        'S3-FIFO': [0.78, 0.64, 0.71, 0.81, 0.84, 0.72, 0.54].map(function (v) { return Math.round((1 - v) * 100); })
      },
      fmt: function (v) { return v + '%'; },
      head: ['Dataset', 'Cache saved']
    },
    'chart-threads': {
      type: 'line',
      labels: ['1', '2', '4', '8', '16'],
      series: {
        LRU: [2, 3, 4, 5, 6],
        'S3-FIFO': [2, 7, 12, 18, 28]
      },
      fmt: function (v) { return String(v); },
      head: ['Threads'],
      xTitle: 'Threads'
    },
    'chart-onehit': {
      type: 'bar',
      labels: ['1%', '10%', '50%', '80%'],
      series: {
        Zipf: [0.88, 0.80, 0.52, 0.255],
        MSR: [0.88, 0.8, 0.52, 0.265],
        Twitter: [0.375, 0.26, 0.19, 0.12]
      },
      fmt: function (v) { return Math.round(v * 100) + '%'; },
      head: ['Cache size'],
      xTitle: 'Cache size'
    }
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var charts = {};

  function mode() {
    return document.body.getAttribute('data-md-color-scheme') === 'slate' ? 'dark' : 'light';
  }

  function tokens() {
    var css = getComputedStyle(document.querySelector('.s3') || document.body);
    function v(name) { return css.getPropertyValue(name).trim(); }
    return { ink: v('--s3-ink'), ink2: v('--s3-ink-2'), mute: v('--s3-mute'), line: v('--s3-line'), surface: v('--s3-card') };
  }

  // Short labels at the end of each line, beside the legend
  var endLabels = {
    id: 'endLabels',
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.on) return;
      var ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 12px ' + Chart.defaults.font.family;
      ctx.fillStyle = opts.color;
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach(function (ds, i) {
        var meta = chart.getDatasetMeta(i);
        var pt = meta.data[meta.data.length - 1];
        if (!pt || meta.hidden) return;
        var last = ds.data[ds.data.length - 1];
        ctx.fillText(ds.label + ' ' + last, pt.x + 10, pt.y);
      });
      ctx.restore();
    }
  };

  // Values at the tips of horizontal bars
  var tipLabels = {
    id: 'tipLabels',
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.on) return;
      var ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 12px ' + Chart.defaults.font.family;
      ctx.fillStyle = opts.color;
      ctx.textBaseline = 'middle';
      var meta = chart.getDatasetMeta(0);
      meta.data.forEach(function (bar, i) {
        ctx.fillText(opts.fmt(chart.data.datasets[0].data[i]), bar.x + 8, bar.y);
      });
      ctx.restore();
    }
  };

  // A hairline that follows the hovered x on the line chart
  var crosshair = {
    id: 'crosshair',
    afterDraw: function (chart, args, opts) {
      if (!opts || !opts.on) return;
      var tip = chart.tooltip;
      var active = tip && (tip.getActiveElements ? tip.getActiveElements() : tip._active);
      if (!active || !active.length) return;
      var x = active[0].element.x, area = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  function config(id) {
    var d = DATA[id], t = tokens(), pal = SERIES[mode()];
    var names = Object.keys(d.series);
    var hbar = d.type === 'hbar', line = d.type === 'line';
    var narrow = document.getElementById(id).parentElement.clientWidth < 520;

    var datasets = names.map(function (name) {
      var c = pal[name];
      var ds = { label: name, data: d.series[name], backgroundColor: c, borderColor: c };
      if (line) {
        ds.borderWidth = 2;
        ds.borderCapStyle = 'round';
        ds.borderJoinStyle = 'round';
        ds.pointRadius = 4;
        ds.pointHoverRadius = 6;
        ds.pointBorderWidth = 2;
        ds.pointBorderColor = t.surface;
        ds.pointHoverBorderColor = t.surface;
        ds.pointHoverBorderWidth = 2;
        ds.tension = 0;
      } else {
        // 4px rounded data ends, square at the baseline, and a 2px gap in the
        // surface color between neighbouring bars
        ds.borderRadius = hbar ? { topRight: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 };
        ds.borderSkipped = 'start';
        ds.borderWidth = hbar ? { top: 1, bottom: 1 } : { left: 1, right: 1 };
        ds.borderColor = t.surface;
        ds.maxBarThickness = hbar ? 20 : (names.length > 3 ? 16 : 20);
        ds.pointStyle = 'rect';
      }
      return ds;
    });

    var grid = { color: t.line, drawBorder: false, tickLength: 0, borderDash: [] };
    var ticks = { color: t.mute, padding: 8, font: { size: 12 } };
    var valueAxis = {
      beginAtZero: true,
      grid: grid,
      ticks: Object.assign({}, ticks, {
        maxTicksLimit: 6,
        callback: function (v) { return hbar ? v + '%' : id === 'chart-onehit' ? Math.round(v * 100) + '%' : v; }
      })
    };
    var categoryAxis = {
      grid: { display: false, drawBorder: false },
      ticks: Object.assign({}, ticks, { color: t.ink2 })
    };
    if (d.xTitle) categoryAxis.title = { display: true, text: d.xTitle, color: t.mute, font: { size: 12 }, padding: { top: 8 } };
    if (hbar) valueAxis.max = 50;
    if (id === 'chart-onehit') valueAxis.max = 1;

    return {
      type: line ? 'line' : 'bar',
      data: { labels: d.labels, datasets: datasets },
      plugins: [endLabels, tipLabels, crosshair],
      options: {
        indexAxis: hbar ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 700, easing: 'easeOutQuart' },
        layout: { padding: { right: line ? (narrow ? 84 : 96) : hbar ? 40 : 4, top: 4 } },
        interaction: { mode: hbar ? 'nearest' : 'index', intersect: hbar, axis: hbar ? 'y' : 'x' },
        scales: hbar ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
        plugins: {
          legend: {
            display: names.length > 1,
            position: 'top',
            align: 'start',
            labels: {
              color: t.ink2,
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              padding: 14,
              font: { size: 12, weight: '500' },
              generateLabels: function (chart) {
                return chart.data.datasets.map(function (ds, i) {
                  return {
                    text: ds.label, fillStyle: ds.backgroundColor, strokeStyle: ds.backgroundColor,
                    lineWidth: line ? 2 : 0, pointStyle: line ? 'line' : 'rect',
                    hidden: !chart.isDatasetVisible(i), datasetIndex: i, fontColor: t.ink2
                  };
                });
              }
            }
          },
          tooltip: {
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: 1,
            titleColor: t.mute,
            bodyColor: t.ink,
            titleFont: { size: 12, weight: '500' },
            bodyFont: { size: 13, weight: '600' },
            padding: 10,
            cornerRadius: 8,
            caretSize: 0,
            usePointStyle: true,
            boxWidth: 12,
            boxHeight: 2,
            callbacks: {
              title: function (items) {
                var x = items[0].label;
                return id === 'chart-threads' ? x + (x === '1' ? ' thread' : ' threads') : x;
              },
              // Values lead, series names follow
              label: function (item) { return ' ' + d.fmt(item.raw) + '  ' + item.dataset.label; },
              labelPointStyle: function () { return { pointStyle: 'line', rotation: 0 }; },
              labelColor: function (item) {
                var c = pal[item.dataset.label];
                return { borderColor: c, backgroundColor: c, borderWidth: 2 };
              }
            }
          },
          endLabels: { on: line, color: t.ink2 },
          tipLabels: { on: hbar, color: t.ink2, fmt: d.fmt },
          crosshair: { on: line, color: t.mute }
        }
      }
    };
  }

  function table(id) {
    var d = DATA[id], box = document.querySelector('[data-table="' + id + '"]');
    if (!box || box.firstChild) return;
    var names = Object.keys(d.series);
    var tbl = document.createElement('table');
    var tr = tbl.createTHead().insertRow();
    var heads = d.head.length > 1 ? d.head : d.head.concat(names);
    heads.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    });
    var body = tbl.createTBody();
    d.labels.forEach(function (label, i) {
      var row = body.insertRow();
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      row.appendChild(th);
      names.forEach(function (name) { row.insertCell().textContent = d.fmt(d.series[name][i]); });
    });
    box.appendChild(tbl);
  }

  function draw(id, animate) {
    var canvas = document.getElementById(id);
    if (!canvas || !canvas.parentElement.clientWidth) return;
    if (charts[id]) charts[id].destroy();
    var cfg = config(id);
    if (!animate) cfg.options.animation = false;
    charts[id] = new Chart(canvas, cfg);
  }

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;

  var ids = Object.keys(DATA);
  ids.forEach(table);

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        draw(e.target.id, true);
      });
    }, { rootMargin: '0px 0px -15% 0px' });
    ids.forEach(function (id) { var c = document.getElementById(id); if (c) io.observe(c); });
  } else {
    ids.forEach(function (id) { draw(id, false); });
  }

  // Redraw in the new colors when the reader switches between light and dark
  new MutationObserver(function () {
    Object.keys(charts).forEach(function (id) { draw(id, false); });
  }).observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
})();
