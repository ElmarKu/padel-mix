function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ensureTooltip(container) {
  let tip = container.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    container.appendChild(tip);
  }
  return tip;
}

function attachTooltip(container, selector) {
  const tip = ensureTooltip(container);
  container.querySelectorAll(selector).forEach((mark) => {
    const show = (e) => {
      tip.textContent = mark.dataset.tip;
      tip.classList.add('visible');
      const rect = container.getBoundingClientRect();
      const x = (e.clientX ?? mark.getBoundingClientRect().left) - rect.left;
      const y = (e.clientY ?? mark.getBoundingClientRect().top) - rect.top;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    mark.addEventListener('pointerenter', show);
    mark.addEventListener('pointermove', show);
    mark.addEventListener('pointerleave', () => tip.classList.remove('visible'));
    mark.addEventListener('focus', show);
    mark.addEventListener('blur', () => tip.classList.remove('visible'));
  });
}

function renderBarChart(container, items, { formatValue = (v) => String(v) } = {}) {
  const maxValue = Math.max(...items.map((i) => i.value), 1);
  const rows = items
    .map(
      (item) => `
    <div class="bar-row" tabindex="0" data-tip="${escapeHtml(item.label)}: ${escapeHtml(formatValue(item.value))}">
      <span class="bar-label">${escapeHtml(item.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.value / maxValue) * 100}%"></div></div>
      <span class="bar-value">${escapeHtml(formatValue(item.value))}</span>
    </div>`
    )
    .join('');
  container.innerHTML = `<div class="bar-chart">${rows}</div>`;
  attachTooltip(container, '.bar-row');
}

function renderLineChart(container, series, xLabels) {
  const width = 600;
  const height = 260;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allValues = series.flatMap((s) => s.points.filter((v) => v != null));
  const rawMax = Math.max(...allValues, 1);
  const niceMax = Math.max(10, Math.ceil(rawMax / 10) * 10);
  const n = xLabels.length;
  const xStep = n > 1 ? plotW / (n - 1) : 0;
  const xAt = (i) => padL + i * xStep;
  const yAt = (v) => padT + plotH - (v / niceMax) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const y = padT + plotH * (1 - t);
      const val = Math.round(niceMax * t);
      return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" class="chart-grid" />
        <text x="${padL - 8}" y="${y + 4}" class="chart-axis-label" text-anchor="end">${val}</text>`;
    })
    .join('');

  const paths = series
    .map((s) => {
      let d = '';
      let drawing = false;
      s.points.forEach((v, i) => {
        if (v == null) { drawing = false; return; }
        const x = xAt(i);
        const y = yAt(v);
        d += `${drawing ? ' L' : ' M'}${x} ${y}`;
        drawing = true;
      });
      return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('');

  const dots = series
    .map((s) =>
      s.points
        .map((v, i) => {
          if (v == null) return '';
          const x = xAt(i);
          const y = yAt(v);
          return `<circle cx="${x}" cy="${y}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" class="chart-dot" tabindex="0" data-tip="${escapeHtml(s.name)} — ${xLabels[i]}: ${v}"></circle>`;
        })
        .join('')
    )
    .join('');

  const xTicks = xLabels
    .map((lbl, i) => `<text x="${xAt(i)}" y="${height - 6}" class="chart-axis-label" text-anchor="middle">${escapeHtml(lbl)}</text>`)
    .join('');

  const legend = series
    .map((s) => `<span class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`)
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart" preserveAspectRatio="xMidYMid meet">
      ${gridLines}
      ${paths}
      ${dots}
      ${xTicks}
    </svg>
    <div class="chart-legend">${legend}</div>
  `;
  attachTooltip(container, '.chart-dot');
}

export { renderBarChart, renderLineChart };
