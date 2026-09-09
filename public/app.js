// ---------- Tab switching ----------

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
}

tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// ---------- Shared helpers ----------

const loadingLinesByMode = {
  ideate: [
    'Selecting this run\'s focus category…',
    'Scanning structural forces and current signals…',
    'Checking venture and studio activity…',
    'Searching consumer research and category data…',
    'Reading trade press and what\'s spreading…',
    'Checking social and community signals…',
    'Cross-referencing SGG\'s portfolio and prior ideas…',
    'Running the competitive check…',
    'Weighing candidate angles…',
    'Screening against the seven questions…',
    'Drafting the write-up…',
    'Finalizing sources and citations…',
  ],
  validate: [
    'Reading the submitted idea…',
    'Checking SGG\'s portfolio and prior ideas for repetition…',
    'Searching for direct competitors…',
    'Searching for adjacent and substitute products…',
    'Checking for well-funded incumbents…',
    'Weighing evidence for the problem claim…',
    'Weighing evidence against the problem claim…',
    'Assessing the market opportunity…',
    'Evaluating the edge…',
    'Running the competitive check…',
    'Drafting the research memo…',
    'Finalizing the rating and recommendation…',
  ],
  launch: [
    'Reading the idea to build a plan for…',
    'Researching comparable pricing…',
    'Searching the competitive landscape…',
    'Building the market opportunity case…',
    'Drafting the business model section…',
    'Working through go-to-market…',
    'Identifying key challenges…',
    'Planning the team and operations…',
    'Staging the capital plan…',
    'Writing the one-pager…',
    'Setting financial assumptions…',
    'Finalizing sources and citations…',
  ],
};

const STILL_WORKING_LINE = 'Still working — real research takes a few minutes…';
const LOADING_STEP_MS = 18000; // ~18s per line, ~12 lines ≈ 3.5 minutes before settling on the final line

const loadingTimers = {};

function startLoading(mode) {
  const box = document.querySelector(`[data-loading-for="${mode}"]`);
  const line = box.querySelector('.loading-line');
  const lines = loadingLinesByMode[mode] || loadingLinesByMode.ideate;
  let i = 0;
  line.textContent = lines[0];
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadingTimers[mode] = setInterval(() => {
    i += 1;
    line.textContent = i < lines.length ? lines[i] : STILL_WORKING_LINE;
  }, LOADING_STEP_MS);
}

function stopLoading(mode) {
  clearInterval(loadingTimers[mode]);
  document.querySelector(`[data-loading-for="${mode}"]`).hidden = true;
}

function showError(mode, message) {
  const box = document.querySelector(`[data-error-for="${mode}"]`);
  box.textContent = message;
  box.hidden = false;
}
function hideError(mode) {
  document.querySelector(`[data-error-for="${mode}"]`).hidden = true;
}

function renderStars(container, n) {
  const total = 5;
  const filled = Math.max(0, Math.min(total, Number(n) || 0));
  let html = '';
  for (let i = 0; i < total; i++) html += `<span class="${i < filled ? 'filled' : ''}">★</span>`;
  container.innerHTML = html;
}

function renderGates(container, gates) {
  container.innerHTML = '';
  // All seven questions now do real, meaningful work (Invention/G4 in particular
  // carries the geographic-replication test), so all seven are shown -- no gate
  // is hidden the way "Stage" used to be.
  (gates || []).forEach((g) => {
    const cls = (g.verdict || '').toLowerCase();
    const div = document.createElement('div');
    div.className = `gate ${cls}`;
    div.innerHTML = `
      <div class="id">${g.id || ''}</div>
      <div class="label">${g.label || ''}</div>
      <div class="verdict">${g.verdict || ''}</div>
    `;
    div.title = g.note || '';
    container.appendChild(div);
  });
}

function renderSources(container, sources) {
  const wrap = container.closest('.sources-wrap') || container.parentElement;
  container.innerHTML = '';
  if (sources && sources.length) {
    sources.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="footnote-num">[${i + 1}]</span> <a href="${s.url}" target="_blank" rel="noopener">${s.title || s.url}</a>`;
      container.appendChild(li);
    });
    if (wrap) wrap.hidden = false;
  } else if (wrap) {
    wrap.hidden = true;
  }
}

function mockBadge(nameEl, isMock) {
  if (!isMock) return;
  const badge = document.createElement('span');
  badge.textContent = ' (preview — connect ANTHROPIC_API_KEY for live runs)';
  badge.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--maybe);font-weight:400;';
  nameEl.appendChild(badge);
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function friendlyError(data) {
  if (data.error === 'bad_model_output') return 'The engine returned something unparseable. Try again — this is rare.';
  if (data.error === 'missing_idea') return 'Enter an idea first.';
  return 'The engine hit a snag. Try again in a moment.';
}

// ---------- IDEATE ----------

document.getElementById('ideate-generate-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  const resultEl = document.getElementById('ideate-result');

  hideError('ideate');
  resultEl.hidden = true;
  btn.disabled = true;
  startLoading('ideate');

  try {
    const { ok, data } = await postJSON('/api/ideate', {});
    if (!ok) { showError('ideate', friendlyError(data)); return; }

    const idea = data.result;
    const nameEl = resultEl.querySelector('.r-name');
    nameEl.textContent = idea.idea_name || 'Untitled idea';
    mockBadge(nameEl, data.mock);
    resultEl.querySelector('.one-liner').textContent = idea.one_liner || '';
    renderStars(resultEl.querySelector('.stars'), idea.confidence_stars);
    resultEl.querySelector('.r-problem').textContent = idea.problem || '';
    resultEl.querySelector('.r-solution').textContent = idea.solution || '';
    resultEl.querySelector('.r-why-now').textContent = idea.why_now || '';
    renderGates(resultEl.querySelector('.gates'), idea.gates);

    const planRows = resultEl.querySelector('.plan-rows');
    planRows.innerHTML = '';
    [
      ['Problem', idea.business_plan?.problem],
      ['Solution & model', idea.business_plan?.solution_and_model],
      ['Market & edge', idea.business_plan?.market_and_edge],
      ['Key challenges', idea.business_plan?.key_challenges],
      ['Go-to-market', idea.business_plan?.go_to_market],
    ].forEach(([k, v]) => {
      if (!v) return;
      const row = document.createElement('div');
      row.className = 'plan-row';
      row.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
      planRows.appendChild(row);
    });

    renderSources(resultEl.querySelector('.sources-list'), idea.sources);

    resultEl.querySelector('.send-to-launch').onclick = () => sendToLaunch(summarizeForLaunch(idea, 'ideate'));

    stopLoading('ideate');
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('ideate', 'Could not reach the engine. Check your connection and try again.');
  } finally {
    stopLoading('ideate');
    btn.disabled = false;
  }
});

// ---------- VALIDATE ----------

document.getElementById('validate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ideaText = document.getElementById('validate-idea').value.trim();
  const resultEl = document.getElementById('validate-result');
  const btn = e.target.querySelector('button');

  hideError('validate');
  if (!ideaText) { showError('validate', 'Enter an idea first.'); return; }

  resultEl.hidden = true;
  btn.disabled = true;
  startLoading('validate');

  try {
    const { ok, data } = await postJSON('/api/validate', { idea: ideaText });
    if (!ok) { showError('validate', friendlyError(data)); return; }

    const idea = data.result;
    const nameEl = resultEl.querySelector('.r-name');
    nameEl.textContent = idea.idea_name || 'Untitled idea';
    mockBadge(nameEl, data.mock);
    resultEl.querySelector('.one-liner').textContent = idea.one_liner || '';
    renderStars(resultEl.querySelector('.stars'), idea.confidence_stars);

    const oaEl = resultEl.querySelector('.overview-assessment');
    oaEl.innerHTML = '';
    const oa = idea.overview_assessment || {};
    [
      ['Problem', oa.problem],
      ['Solution', oa.solution],
      ['Market Opportunity', oa.market_opportunity],
      ['Edge', oa.edge],
    ].forEach(([label, part]) => {
      if (!part) return;
      const div = document.createElement('div');
      div.className = 'evidence-block';
      div.innerHTML = `
        <h3>${label}</h3>
        <div class="evidence-row"><span class="evidence-tag for">Evidence for</span><p>${part.evidence_for || ''}</p></div>
        <div class="evidence-row"><span class="evidence-tag against">Evidence against</span><p>${part.evidence_against || ''}</p></div>
      `;
      oaEl.appendChild(div);
    });

    const compEl = resultEl.querySelector('.competitors');
    compEl.innerHTML = '';
    (idea.competitors || []).forEach((c) => {
      const div = document.createElement('div');
      div.className = 'card';
      const scale = c.scale && c.scale.toLowerCase() !== 'unknown' ? `<span class="scale-tag">${c.scale}</span>` : '';
      div.innerHTML = `<h3>${c.name} ${scale}</h3><p>${c.note || ''}</p>`;
      compEl.appendChild(div);
    });
    if (!idea.competitors || !idea.competitors.length) {
      compEl.innerHTML = '<p class="hint">No direct competitors found in this search.</p>';
    }

    renderGates(resultEl.querySelector('.gates'), idea.gates);
    resultEl.querySelector('.r-confidence-rationale').textContent = idea.confidence_rationale || '';

    const risksEl = resultEl.querySelector('.risks-list');
    risksEl.innerHTML = '';
    (idea.key_risks || []).forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      risksEl.appendChild(li);
    });

    resultEl.querySelector('.r-recommendation').textContent = idea.recommendation || '';
    renderSources(resultEl.querySelector('.sources-list'), idea.sources);

    resultEl.querySelector('.send-to-launch').onclick = () => sendToLaunch(summarizeForLaunch(idea, 'validate'));

    stopLoading('validate');
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('validate', 'Could not reach the engine. Check your connection and try again.');
  } finally {
    stopLoading('validate');
    btn.disabled = false;
  }
});

// ---------- LAUNCH ----------

function summarizeForLaunch(idea, source) {
  if (source === 'ideate') {
    return `${idea.idea_name}: ${idea.one_liner}\n\nProblem: ${idea.problem}\n\nSolution: ${idea.solution}\n\nWhy now: ${idea.why_now}`;
  }
  const oa = idea.overview_assessment || {};
  return `${idea.idea_name}: ${idea.one_liner}\n\nProblem: ${oa.problem?.evidence_for || ''}\n\nSolution: ${oa.solution?.evidence_for || ''}\n\nMarket: ${oa.market_opportunity?.evidence_for || ''}\n\nEdge: ${oa.edge?.evidence_for || ''}`;
}

function sendToLaunch(text) {
  document.getElementById('launch-idea').value = text;
  switchTab('launch');
}

document.getElementById('launch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ideaText = document.getElementById('launch-idea').value.trim();
  const resultEl = document.getElementById('launch-result');
  const btn = e.target.querySelector('button');

  hideError('launch');
  if (!ideaText) { showError('launch', 'Enter or send over an idea first.'); return; }

  resultEl.hidden = true;
  btn.disabled = true;
  startLoading('launch');

  try {
    const { ok, data } = await postJSON('/api/plan', { idea: ideaText });
    if (!ok) { showError('launch', friendlyError(data)); return; }

    const plan = data.result;
    const nameEl = resultEl.querySelector('.r-name');
    nameEl.textContent = plan.plan_title || 'Business Plan';
    mockBadge(nameEl, data.mock);
    resultEl.querySelector('.one-liner').textContent = plan.one_liner || '';

    const overviewEl = resultEl.querySelector('.plan-overview');
    if (plan.overview) {
      overviewEl.innerHTML = `
        <div class="card"><h3>Problem</h3><p>${plan.overview.problem || ''}</p></div>
        <div class="card"><h3>Solution</h3><p>${plan.overview.solution || ''}</p></div>
        <div class="card"><h3>Edge</h3><p>${plan.overview.edge || ''}</p></div>
      `;
      overviewEl.hidden = false;
    } else {
      overviewEl.hidden = true;
    }

    const sectionsEl = resultEl.querySelector('.plan-sections');
    sectionsEl.innerHTML = '';
    (plan.sections || []).forEach((s) => {
      const div = document.createElement('div');
      div.className = 'plan-section';
      div.innerHTML = `<h3>${s.heading}</h3><p>${s.body}</p>`;
      sectionsEl.appendChild(div);
    });

    renderSources(resultEl.querySelector('.sources-list'), plan.sources);

    const onePagerEl = resultEl.querySelector('#one-pager-card');
    if (plan.one_pager) {
      const op = plan.one_pager;
      const whoServesHtml = (op.who_it_serves || [])
        .map((seg) => `<div class="op-segment"><p class="op-seg-title">${seg.segment || ''}</p><p class="op-seg-benefit">${seg.benefit || ''}</p></div>`)
        .join('');
      onePagerEl.innerHTML = `
        <p class="op-subtitle">${op.subtitle || ''}</p>
        <h4 class="op-section-h">Overview</h4><p>${op.overview || ''}</p>
        <h4 class="op-section-h">The Thesis</h4><p>${op.thesis || ''}</p>
        <h4 class="op-section-h">The Opportunity</h4><p>${op.opportunity || ''}</p>
        <h4 class="op-section-h">Strategy</h4><p>${op.strategy || ''}</p>
        <h4 class="op-section-h">Who It Serves</h4>
        <div class="op-who-serves">${whoServesHtml}</div>
        <h4 class="op-section-h">Current Focus</h4><p>${op.current_focus || ''}</p>
        <h4 class="op-section-h">Vision</h4><p>${op.vision || ''}</p>
      `;
    } else {
      onePagerEl.innerHTML = '<p class="hint">No one-pager returned for this run.</p>';
    }
    resultEl.querySelector('.print-one-pager').onclick = () => printOnePager(plan);

    const excelBtn = resultEl.querySelector('.download-excel');
    if (plan.financials) {
      excelBtn.disabled = false;
      excelBtn.onclick = () => downloadFinancialModel(plan.plan_title, plan.financials);
    } else {
      excelBtn.disabled = true;
    }

    resultEl.querySelector('.download-plan').onclick = () => downloadPlanAsText(plan);

    stopLoading('launch');
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('launch', 'Could not reach the engine. Check your connection and try again.');
  } finally {
    stopLoading('launch');
    btn.disabled = false;
  }
});

function printOnePager(plan) {
  const op = plan.one_pager || {};
  const w = window.open('', '_blank');
  const title = (plan.plan_title || '').replace(/^Business Plan:\s*/i, '');
  const whoServes = (op.who_it_serves || [])
    .map((seg) => `
      <div class="segment">
        <p class="seg-title"><span class="bullet">o</span> ${seg.segment || ''}</p>
        <p class="seg-benefit">${seg.benefit || ''}</p>
      </div>`)
    .join('');
  w.document.write(`
    <html><head><title>${plan.plan_title} - One Pager</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');
      * { box-sizing: border-box; }
      body {
        font-family: Georgia, 'Times New Roman', serif;
        max-width: 800px; margin: 0 auto; padding: 50px 56px 40px;
        color: #262624;
        background: url('/images/sgg-background.jpg') center top / cover no-repeat, #ffffff;
      }
      .letterhead { text-align: center; margin-bottom: 20px; }
      .letterhead img { height: 56px; width: auto; }
      h1 {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 20px; font-weight: 700; letter-spacing: 0.02em;
        text-align: center; text-transform: uppercase; color: #3a3a38;
        margin: 0 0 4px;
      }
      h2 {
        font-size: 13px; font-style: italic; font-weight: 600;
        text-align: center; color: #6b6b68; margin: 0 0 26px;
      }
      h3 {
        font-size: 12.5px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.03em; color: #262624; margin: 20px 0 6px;
      }
      p { margin: 0 0 4px; line-height: 1.55; font-size: 12.5px; text-align: justify; }
      .who-serves { display: flex; gap: 24px; margin-top: 8px; }
      .segment { flex: 1; }
      .seg-title { font-weight: 700; text-align: left; margin-bottom: 4px; }
      .seg-benefit { text-align: left; font-style: normal; }
      .bullet { font-weight: 700; margin-right: 4px; }
      .footer {
        margin-top: 30px; padding-top: 14px; border-top: 1px solid #d8d5cc;
        text-align: center;
      }
      .footer .ft-title { font-weight: 700; text-transform: uppercase; font-size: 12px; margin: 0 0 2px; }
      .footer .ft-subtitle { font-style: italic; font-size: 11px; color: #6b6b68; margin: 0 0 10px; text-transform: uppercase; }
      .footer .contact { font-size: 11px; color: #2a5db0; }
      @media print { body { padding: 20px 32px; } }
    </style></head><body>
      <div class="letterhead"><img src="/images/sgg-logo.png" alt="SGG Foundry" /></div>
      <h1>SGG Foundry's Next Venture: ${title}</h1>
      <h2>${op.subtitle || ''}</h2>

      <h3>Overview</h3>
      <p>${op.overview || ''}</p>

      <h3>The Thesis</h3>
      <p>${op.thesis || ''}</p>

      <h3>The Opportunity</h3>
      <p>${op.opportunity || ''}</p>

      <h3>Strategy</h3>
      <p>${op.strategy || ''}</p>

      <h3>Who It Serves</h3>
      <div class="who-serves">${whoServes}</div>

      <h3>Current Focus</h3>
      <p>${op.current_focus || ''}</p>

      <h3>Vision</h3>
      <p>${op.vision || ''}</p>

      <div class="footer">
        <p class="ft-title">SGG Foundry's Next Venture: ${title}</p>
        <p class="ft-subtitle">${op.subtitle || ''}</p>
        <p class="contact">+972.(0)3.641.1112 &nbsp;|&nbsp; info@SternGlobalGroup.com &nbsp;|&nbsp; www.SternGlobalGroup.com</p>
      </div>
    </body></html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

async function downloadFinancialModel(planTitle, financials) {
  try {
    const res = await fetch('/api/plan/excel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planTitle, financials }),
    });
    if (!res.ok) {
      alert('Could not generate the financial model. Try again in a moment.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(planTitle || 'financial-model').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Could not reach the engine to build the financial model.');
  }
}

function downloadPlanAsText(plan) {
  let text = `${plan.plan_title}\n${plan.one_liner}\n\n`;
  if (plan.overview) {
    text += `OVERVIEW\nProblem: ${plan.overview.problem}\nSolution: ${plan.overview.solution}\nEdge: ${plan.overview.edge}\n\n`;
  }
  (plan.sections || []).forEach((s) => {
    text += `${s.heading.toUpperCase()}\n${s.body}\n\n`;
  });
  if (plan.sources && plan.sources.length) {
    text += 'SOURCES\n';
    plan.sources.forEach((s) => { text += `- ${s.title}: ${s.url}\n`; });
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(plan.plan_title || 'business-plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Logout & Library ----------

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

let libraryLoaded = false;

async function loadLibrary() {
  if (libraryLoaded) return;
  const wrap = document.getElementById('library-content');
  try {
    const res = await fetch('/api/library');
    if (!res.ok) return;
    const { library } = await res.json();
    wrap.innerHTML = '';
    Object.entries(library || {}).forEach(([category, ideas]) => {
      const section = document.createElement('div');
      section.className = 'library-category';
      const ideaCards = (ideas || [])
        .map((idea) => `<div class="card"><h3>${idea.idea_name}</h3><p>${idea.one_liner}</p></div>`)
        .join('');
      section.innerHTML = `
        <h3 class="section-label">${category}</h3>
        <div class="grid three">${ideaCards || '<p class="hint">No ideas in this category yet.</p>'}</div>
      `;
      wrap.appendChild(section);
    });
    libraryLoaded = true;
  } catch (_) {
    // library is a nice-to-have, fail silently
  }
}

const libraryTabBtn = document.querySelector('.tab[data-tab="library"]');
if (libraryTabBtn) libraryTabBtn.addEventListener('click', loadLibrary);

// Library loads lazily when its tab is clicked (see loadLibrary above), not on page init.
