/**
 * The island's interface: mission control, a mission as it runs, the report it
 * ends with, and the missions that came before.
 *
 * Ported from apps/island/src — the same screens, the same class vocabulary and
 * the same map — but drawn with plain DOM against `IslandEngine` rather than
 * with React against an HTTP API.
 *
 * The one thing this version says that the product does not is the disclosure.
 * A published artifact cannot reach the open web: no fetch leaves the page, no
 * connector is attached, and the model behind `sample` has no search tool. So
 * nothing any agent here says was retrieved, and the page is built to keep
 * saying so — the banner in index.html, a banner at the head of every report,
 * a label no output is allowed to carry, and a ceiling on every number the word
 * "confidence" is printed next to.
 */
window.IslandApp = (function () {
  'use strict';

  var ROSTER = window.ISLAND_AGENTS || [];
  var engine = window.IslandEngine || null;

  /* --- vocabulary ---------------------------------------------------------- */

  var STAGE_ORDER = ['plan', 'gather', 'analyse', 'verify', 'quantify', 'strategise', 'review'];

  var STAGE_LABEL = {
    plan: 'Planning',
    gather: 'Gathering',
    analyse: 'Analysis',
    verify: 'Verification',
    quantify: 'Financial',
    strategise: 'Strategy',
    review: 'Chief review',
  };

  var AGENT_STATE_LABEL = {
    waiting: 'Waiting',
    queued: 'Queued',
    working: 'Working',
    completed: 'Completed',
    failed: 'Failed',
    needs_review: 'Needs review',
    retrying: 'Retrying',
    blocked: 'Blocked',
    skipped: 'Skipped',
  };

  var MISSION_STATUS_LABEL = {
    created: 'Draft',
    planning: 'Planning',
    running: 'Running',
    awaiting_approval: 'Awaiting approval',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    aborted: 'Aborted',
  };

  var MISSION_STATUS_TONE = {
    created: 'pill--muted',
    planning: 'pill--info',
    running: 'pill--info',
    awaiting_approval: 'pill--warning',
    paused: 'pill--warning',
    completed: 'pill--positive',
    failed: 'pill--negative',
    aborted: 'pill--negative',
  };

  var LABEL_EMOJI = {
    VERIFIED: '🟢',
    ESTIMATE: '🟡',
    NEEDS_VERIFICATION: '🟠',
    HIGH_RISK: '🔴',
  };

  var LABEL_TEXT = {
    VERIFIED: 'Verified',
    ESTIMATE: 'Estimate',
    NEEDS_VERIFICATION: 'Needs verification',
    HIGH_RISK: 'High risk',
  };

  var LABEL_TONE = {
    VERIFIED: 'verified',
    ESTIMATE: 'estimate',
    NEEDS_VERIFICATION: 'needs',
    HIGH_RISK: 'risk',
  };

  var DECISION_LABEL = {
    proceed: 'Proceed',
    proceed_with_caution: 'Proceed with caution',
    more_research: 'More research required',
    do_not_proceed: 'Do not proceed',
  };

  var DECISION_TONE = {
    proceed: 'proceed',
    proceed_with_caution: 'caution',
    more_research: 'research',
    do_not_proceed: 'stop',
  };

  var DECISION_PILL = {
    proceed: 'pill--positive',
    proceed_with_caution: 'pill--warning',
    more_research: 'pill--info',
    do_not_proceed: 'pill--negative',
  };

  var SEVERITY_LEAD = {
    high: 'High severity',
    medium: 'Medium severity',
    low: 'Low severity',
  };

  /** Statuses where the mission is still moving. */
  var LIVE = {
    created: true,
    planning: true,
    running: true,
    awaiting_approval: true,
    paused: true,
  };

  /** Events that change stored data rather than only the narration. */
  var RELOAD_ON = {
    stage_started: true,
    agent_completed: true,
    agent_failed: true,
    agent_skipped: true,
    challenge: true,
    correction_requested: true,
    correction_applied: true,
    verification_result: true,
    approval_required: true,
    approval_granted: true,
    mission_paused: true,
    mission_resumed: true,
    mission_completed: true,
    mission_failed: true,
    mission_aborted: true,
  };

  var EVENT_STATE = {
    agent_queued: 'queued',
    agent_started: 'working',
    agent_completed: 'completed',
    agent_failed: 'failed',
    agent_retrying: 'retrying',
    agent_skipped: 'skipped',
    // A correction round is a real run of that agent and it ends with
    // `correction_applied`; without this the map shows a corrected agent working
    // forever on a mission that has already finished.
    correction_applied: 'completed',
  };

  var TIMELINE_TONE = {
    agent_queued: 'agent',
    agent_started: 'agent',
    agent_progress: 'agent',
    handoff: 'agent',
    agent_completed: 'good',
    mission_completed: 'good',
    approval_granted: 'good',
    correction_applied: 'good',
    agent_failed: 'alert',
    agent_retrying: 'alert',
    challenge: 'alert',
    correction_requested: 'alert',
    verification_result: 'alert',
    approval_required: 'alert',
    mission_failed: 'alert',
    mission_aborted: 'alert',
  };

  /** Fields every agent returns; anything else came from that agent's own schema. */
  var CORE_OUTPUT_KEYS = {
    mission_id: true,
    agent: true,
    status: true,
    findings: true,
    evidence: true,
    issues: true,
    assumptions: true,
    recommendations: true,
    next_agent_instructions: true,
    confidence: true,
  };

  /** The three agents added for currency work. Their whole job is prices, and
   *  this island has none, so a mission that ran them earns a sentence of its own. */
  var FOREX_AGENTS = ['market_context', 'technical_analysis', 'trade_thesis'];

  var MODES = [
    {
      value: 'auto',
      title: 'Automatic',
      body: 'The island runs the whole mission end to end and tells you when it is done.',
    },
    {
      value: 'approval',
      title: 'Approval gates',
      body: 'The island stops after each stage and waits for you to read it and approve.',
    },
  ];

  /* --- what this island is not allowed to claim ---------------------------- */

  /**
   * The page's last line of defence.
   *
   * The engine strips VERIFIED and clamps confidence before anything is stored,
   * but this is the surface a person actually reads, so it strips them again on
   * the way out. An agent that talks its way past the engine still cannot print
   * the word "Verified" here, because nothing on this island was ever read.
   */
  var CONFIDENCE_CEILING = 0.6;

  function honestLabel(label) {
    if (!LABEL_TEXT[label] || label === 'VERIFIED') return 'NEEDS_VERIFICATION';
    return label;
  }

  function wasDowngraded(label) {
    return label === 'VERIFIED';
  }

  function honestConfidence(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    return Math.max(0, Math.min(CONFIDENCE_CEILING, value));
  }

  var CEILING_NOTE =
    'Held at 60%: nothing on this island was retrieved, so no claim behind this number carries a source.';

  /* --- small DOM helpers --------------------------------------------------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i += 1) append(node, children[i]);
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    node.appendChild(children);
  }

  function make(ns, tag, attrs, children) {
    var node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (typeof value === 'function') {
          node.addEventListener(key.replace(/^on/, ''), value);
          return;
        }
        if (key === 'text') {
          node.textContent = String(value);
          return;
        }
        node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    append(node, children);
    return node;
  }

  function h(tag, attrs, children) {
    return make(null, tag, attrs, children);
  }

  function sv(tag, attrs, children) {
    return make(SVG_NS, tag, attrs, children);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fill(node, children) {
    clear(node);
    append(node, children);
    return node;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  /* --- formatting ---------------------------------------------------------- */

  function humanise(key) {
    var words = String(key).replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function formatMoney(value, currency) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }).format(value);
    } catch (caught) {
      return (currency || 'USD') + ' ' + Math.round(value).toLocaleString();
    }
  }

  function formatPercent(value) {
    return typeof value === 'number' && isFinite(value) ? Math.round(value * 100) + '%' : '—';
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatDuration(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    var seconds = ms / 1000;
    if (seconds < 60) return seconds.toFixed(1) + ' s';
    var minutes = Math.floor(seconds / 60);
    return minutes + ' min ' + Math.round(seconds - minutes * 60) + ' s';
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  /* --- marks --------------------------------------------------------------- */

  /**
   * One line glyph per agent, on a 24×24 grid, stroke-based so it inherits its
   * colour and survives being drawn at four map units inside a station.
   *
   * The fourteen product marks are carried over unchanged; the three at the end
   * are new, because the forex agents arrived after the set was drawn and a
   * station with nothing inside it reads as a rendering fault.
   */
  function circlePath(cx, cy, r) {
    var left = cx - r;
    var right = cx + r;
    return 'M' + right + ' ' + cy + 'A' + r + ' ' + r + ' 0 0 1 ' + left + ' ' + cy +
      'A' + r + ' ' + r + ' 0 0 1 ' + right + ' ' + cy + 'Z';
  }

  var FALLBACK_GLYPH =
    'M8.4 5.4H15.6A3 3 0 0 1 18.6 8.4V15.6A3 3 0 0 1 15.6 18.6H8.4' +
    'A3 3 0 0 1 5.4 15.6V8.4A3 3 0 0 1 8.4 5.4ZM9.2 12H14.8';

  var AGENT_GLYPHS = {
    task_manager: circlePath(12, 12, 8.2) + 'M9 15.2L12 12L15.6 8.6',
    research: circlePath(10.4, 10.4, 6.2) + 'M15 15L20.2 20.2',
    competitor: circlePath(9.4, 12, 5.9) + circlePath(14.6, 12, 5.9),
    customer_research:
      'M7.4 5H16.6A2.4 2.4 0 0 1 19 7.4V13.8A2.4 2.4 0 0 1 16.6 16.2H11' +
      'L7.6 19.4V16.2H7.4A2.4 2.4 0 0 1 5 13.8V7.4A2.4 2.4 0 0 1 7.4 5Z',
    technology:
      'M8.2 5.6H15.8A2.6 2.6 0 0 1 18.4 8.2V15.8A2.6 2.6 0 0 1 15.8 18.4H8.2' +
      'A2.6 2.6 0 0 1 5.6 15.8V8.2A2.6 2.6 0 0 1 8.2 5.6Z' +
      'M9.8 9.8H14.2V14.2H9.8Z',
    legal: 'M4.4 11.0L6.4 6.2H17.6L19.6 11.0M12 6.2V18.6M7.8 18.6H16.2',
    market_analysis: 'M5.6 18.8V13.6M12 18.8V9.2M18.4 18.8V5.2',
    analysis: 'M12 19V12L6.2 6.2M12 12L17.8 6.2',
    marketing:
      circlePath(6.6, 12, 1.6) + 'M11.2 7.6A6.2 6.2 0 0 1 11.2 16.4M14.2 4.8A9.8 9.8 0 0 1 14.2 19.2',
    risk_verification:
      'M12 4.4L18.6 6.8V12.2C18.6 16.2 15.6 18.8 12 19.8' +
      'C8.4 18.8 5.4 16.2 5.4 12.2V6.8Z' +
      'M9.2 11.8L11.4 14L15 9.6',
    financial: circlePath(12, 12, 7.4) + 'M12 6.2V17.8',
    operations: circlePath(12, 12, 6.8) + circlePath(12, 12, 2.4),
    strategy: 'M6.4 4.4V19.6M6.4 6H18.6L15.4 9.8L18.6 13.6H6.4',
    chief_ai: circlePath(12, 12, 7.4) + 'M8.4 12.2L11 14.8L15.8 9.2',

    // A globe with one meridian: the wider world a currency trades against.
    market_context: circlePath(12, 12, 7.6) + 'M4.4 12H19.6M12 4.4C14.6 7.2 14.6 16.8 12 19.6',
    // A price line with its own corner: the shape of a chart, not a picture of one.
    technical_analysis: 'M4.6 17.2L9.6 11.4L13.6 14.8L19.4 7.4M15.4 7.4H19.4V11.4',
    // Two opposed arrows: a pair, and a position taken on it.
    trade_thesis: 'M5 9.2H17.6L14.4 6M19 14.8H6.4L9.6 18',
  };

  function agentGlyph(agentId, size, className) {
    return sv('svg', {
      'class': className || null,
      viewBox: '0 0 24 24',
      width: size || 18,
      height: size || 18,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    }, sv('path', { d: AGENT_GLYPHS[agentId] || FALLBACK_GLYPH }));
  }

  function alertMark(size) {
    return sv('svg', {
      viewBox: '0 0 24 24',
      width: size || 17,
      height: size || 17,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      // A replaced element with no flex-basis is squeezed by a long enough
      // sentence beside it. That is the mark's own invariant, not a style choice.
      style: 'flex: none',
    }, [
      sv('path', { d: 'M12 4.4L21 19.8H3Z' }),
      sv('path', { d: 'M12 10V13.9M12 16.7H12.01' }),
    ]);
  }

  function chevron(open) {
    return sv('svg', {
      'class': 'muted',
      viewBox: '0 0 24 24',
      width: 14,
      height: 14,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    }, sv('path', { d: open ? 'M6.6 9.6L12 15L17.4 9.6' : 'M9.6 6.6L15 12L9.6 17.4' }));
  }

  /* --- shared pieces ------------------------------------------------------- */

  function eyebrow(text) {
    return h('span', { 'class': 'eyebrow', text: text });
  }

  function heading(text) {
    return h('h2', { 'class': 'report__heading', text: text });
  }

  function hint(text) {
    return h('span', { 'class': 'launch__hint', text: text });
  }

  function small(text, muted) {
    return h('span', { 'class': muted ? 'small muted' : 'small', text: text });
  }

  function errorNote(message, onRetry) {
    return h('div', { 'class': 'alert', role: 'alert' },
      h('div', { 'class': 'row row--between' }, [
        h('span', { 'class': 'row' }, [alertMark(16), h('span', { text: message })]),
        onRetry
          ? h('button', { type: 'button', 'class': 'btn btn--sm btn--ghost', text: 'Try again', onclick: onRetry })
          : null,
      ]));
  }

  function empty(title, body, action) {
    return h('div', { 'class': 'empty stack stack--sm' }, [
      h('span', { 'class': 'strong', text: title }),
      body ? small(body) : null,
      action ? h('div', null, action) : null,
    ]);
  }

  function stat(label, value, note, tone) {
    return h('div', { 'class': 'card stat' }, [
      h('span', { 'class': 'stat__label', text: label }),
      h('span', { 'class': 'stat__value', text: value }),
      note ? h('span', { 'class': 'stat__note' + (tone ? ' stat__note--' + tone : ''), text: note }) : null,
    ]);
  }

  function pill(text, tone) {
    return h('span', { 'class': 'pill' + (tone ? ' ' + tone : ''), text: text });
  }

  function statusPill(status) {
    return pill(MISSION_STATUS_LABEL[status] || humanise(status), MISSION_STATUS_TONE[status] || 'pill--muted');
  }

  function agentStatePill(state) {
    return h('span', { 'class': 'statepill statepill--' + state }, [
      h('span', { 'class': 'statepill__dot', 'aria-hidden': 'true' }),
      AGENT_STATE_LABEL[state] || humanise(state),
    ]);
  }

  /** The label a claim carries. VERIFIED never survives the trip to the screen. */
  function labelChip(rawLabel) {
    var label = honestLabel(rawLabel);
    var text = LABEL_TEXT[label];
    if (wasDowngraded(rawLabel)) text += ' · downgraded, nothing here was retrieved';
    return h('span', { 'class': 'chip chip--' + LABEL_TONE[label] }, [
      h('span', { 'class': 'chip__emoji', 'aria-hidden': 'true', text: LABEL_EMOJI[label] }),
      text,
    ]);
  }

  function confidenceMeter(rawValue, label, note) {
    var safe = honestConfidence(rawValue);
    var percent = Math.round(safe * 100);
    var band = safe >= 0.7 ? 'strong' : safe >= 0.45 ? 'medium' : 'weak';

    return h('div', { 'class': 'meter meter--' + band }, [
      h('div', { 'class': 'meter__head' }, [
        label ? h('span', { 'class': 'meter__label', text: label }) : h('span'),
        h('span', { 'class': 'meter__value tabular', text: percent + '%' }),
      ]),
      h('div', {
        'class': 'meter__track',
        role: 'meter',
        'aria-label': label || 'Confidence',
        'aria-valuenow': percent,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuetext': percent + ' percent',
      }, h('div', { 'class': 'meter__fill', style: 'width: ' + percent + '%' })),
      note ? h('span', { 'class': 'meter__note', text: note }) : null,
    ]);
  }

  /** A disclosure that survives a re-render. The mission screen redraws on every
   *  event, so an inspector left open while the island works would otherwise
   *  snap shut under the reader. */
  function rememberedDetails(key, summary, body) {
    var node = h('details', {
      'class': 'small',
      open: state.open[key] === true,
      ontoggle: function () {
        state.open[key] = node.open;
      },
    }, [h('summary', { text: summary }), body]);
    return node;
  }

  function bullets(items, emptyText, ordered) {
    if (!items || items.length === 0) return small(emptyText, true);
    return h(ordered ? 'ol' : 'ul', { 'class': 'bullets small' }, items.map(function (item) {
      return h('li', null, item);
    }));
  }

  /**
   * Renders whatever an agent's own schema added.
   *
   * Seventeen agents have seventeen shapes and a new specialist arrives with a
   * prompt and a schema and nothing else. The alternative to a generic renderer
   * is a page that quietly drops the half of an agent's work it was not written for.
   */
  function structured(value) {
    if (value === null || value === undefined || value === '') {
      return h('span', { 'class': 'muted', text: '—' });
    }
    if (typeof value === 'boolean') return document.createTextNode(value ? 'yes' : 'no');
    if (typeof value === 'number' || typeof value === 'string') {
      return document.createTextNode(String(value));
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return h('span', { 'class': 'muted', text: 'none' });
      return h('ul', { 'class': 'bullets' }, value.map(function (item) {
        return h('li', null, structured(item));
      }));
    }
    return h('div', { 'class': 'kv' }, Object.keys(value).reduce(function (out, key) {
      out.push(h('span', { 'class': 'kv__key', text: humanise(key) }));
      out.push(h('span', { 'class': 'kv__value' }, structured(value[key])));
      return out;
    }, []));
  }

  /** The disclosure, again, at the head of a report. The banner at the top of
   *  the page is the standing one; this is the one a reader cannot scroll past
   *  on the way to a recommendation. */
  function disclosureBanner(usedForex) {
    return h('div', { 'class': 'sim-notice', role: 'alert' }, [
      alertMark(17),
      h('div', { 'class': 'stack stack--sm' }, [
        h('strong', { text: 'Nothing below was retrieved. Read it as reasoning, not as research.' }),
        h('span', {
          text:
            'This island has no web access, no search tool and no data feed. Every agent answered ' +
            'from what the model already knew, so no figure here was looked up and no source was ' +
            'read. Treat every number, name, cost and date as a starting point to check. No claim ' +
            'may be marked verified and no confidence may exceed 60%.',
        }),
        usedForex
          ? h('span', {
            text:
              'This mission ran the three currency agents. There were no live prices: every rate, ' +
              'level, spread and target below was recalled rather than quoted, and may be stale by ' +
              'years. Do not trade on it.',
          })
          : null,
      ]),
    ]);
  }

  /* --- the map ------------------------------------------------------------- */

  /*
   * Ported from components/Island.tsx. The geometry is the tightest constraint
   * on this page — every number below was measured against label clearance in
   * both frames — so it is carried across unchanged rather than re-derived.
   */

  var HQ_AGENT_ID = 'chief_ai';

  var SHORE = [
    'M8.0 38.0 C7.2 33.9 9.5 26.8 11.5 23.0 C13.5 19.2 17.6 15.1 21.0 13.0',
    'C24.4 10.9 29.9 9.2 34.0 9.0 C38.1 8.8 43.7 11.4 48.0 11.5',
    'C52.3 11.6 57.9 9.0 62.0 9.5 C66.1 10.0 70.4 12.3 75.0 15.0',
    'C79.6 17.7 89.5 22.4 92.0 27.0 C94.5 31.6 92.5 40.2 91.0 45.0',
    'C89.5 49.8 86.1 55.9 82.0 58.5 C77.9 61.1 69.7 62.2 64.0 62.0',
    'C58.3 61.8 50.2 57.7 45.0 57.0 C39.8 56.3 34.3 58.6 30.0 57.5',
    'C25.7 56.4 20.4 53.0 17.0 50.0 C13.6 47.0 8.8 42.1 8.0 38.0 Z',
  ].join(' ');

  var GRASS = [
    'M11.6 37.6 C10.8 33.9 13.1 27.5 15.0 24.0 C16.8 20.6 20.7 17.0 23.9 15.2',
    'C27.1 13.4 32.1 12.1 35.8 12.1 C39.5 12.1 44.3 15.0 48.1 15.1',
    'C51.8 15.2 56.6 12.4 60.3 12.7 C64.0 13.0 67.8 14.8 72.1 17.1',
    'C76.4 19.4 86.1 23.4 88.4 27.6 C90.8 31.7 88.9 39.7 87.5 44.1',
    'C86.1 48.5 83.0 54.1 79.1 56.4 C75.2 58.6 67.4 59.3 62.3 58.8',
    'C57.1 58.4 50.2 54.1 45.6 53.4 C41.0 52.8 36.1 55.5 32.2 54.7',
    'C28.3 53.9 23.4 51.0 20.2 48.4 C17.0 45.8 12.4 41.4 11.6 37.6 Z',
  ].join(' ');

  var ISLAND_CENTRE = { x: 50, y: 35.6 };
  var DEPTH_SCALES = [1.045];
  var CONTOUR_SCALES = [1];

  var STATION_R = 3.6;
  var HQ_R = 4.8;
  var RING_GAP = 0.6;
  var HALO_GAP = 1.1;
  var FOCUS_GAP = 1.3;
  var LABEL_DROP = 3.7;
  var LABEL_LEADING = '1.05em';
  var BADGE_R = 0.95;

  /** A badge as well as a colour, so the states stay apart for anyone who
   *  cannot tell amber from green. */
  var STATE_BADGE = {
    completed: '✓',
    failed: '!',
    needs_review: '?',
    retrying: '↻',
    blocked: '×',
    skipped: '–',
  };

  /** What is happening now, then what is settled, then what is still ahead. */
  var SUMMARY_ORDER = [
    'working', 'retrying', 'completed', 'needs_review',
    'failed', 'blocked', 'queued', 'waiting', 'skipped',
  ];

  function clamp(value, low, high) {
    if (typeof value !== 'number' || !isFinite(value)) return (low + high) / 2;
    return Math.min(high, Math.max(low, value));
  }

  function n(value) {
    return value.toFixed(2);
  }

  /** Radii are derived by addition, which is enough to put binary noise into a
   *  rendered attribute. Two places is finer than a map unit ever needs. */
  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function concentric(centre, scale) {
    return 'translate(' + n(centre.x) + ' ' + n(centre.y) + ') scale(' + scale + ') ' +
      'translate(' + n(-centre.x) + ' ' + n(-centre.y) + ')';
  }

  /** Rewrites every coordinate in a path through `move`. Both shapes above are
   *  nothing but absolute M, C and Z, so every number is half of a point. */
  function mapPath(d, move) {
    var parts = [];
    var pending = null;
    var tokens = d.match(/[MCZ]|-?\d*\.?\d+/g) || [];
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (/[MCZ]/.test(token)) {
        parts.push(token);
        continue;
      }
      var value = Number(token);
      if (pending === null) {
        pending = value;
        continue;
      }
      var moved = move({ x: pending, y: value });
      parts.push(n(moved.x) + ' ' + n(moved.y));
      pending = null;
    }
    return parts.join(' ');
  }

  /** The habitable strip of the wide viewBox. Registry coordinates are advisory:
   *  an agent at the edge of the 0-100 by 0-70 space still has to stand on land
   *  with its label inside the frame. */
  var WIDE_SPAN = { x0: 11, x1: 88, y0: 12, y1: 57 };

  function placeWide(agent, hq) {
    var x = WIDE_SPAN.x0 + (clamp(agent.map.x, 0, 100) / 100) * (WIDE_SPAN.x1 - WIDE_SPAN.x0);
    var y = WIDE_SPAN.y0 + (clamp(agent.map.y, 0, 70) / 70) * (WIDE_SPAN.y1 - WIDE_SPAN.y0);
    // The capital is a third larger than a station, so it needs more room on
    // every side before its ring runs off the frame.
    return hq ? { x: clamp(x, 16, 84), y: clamp(y, 17, 52) } : { x: x, y: y };
  }

  /*
   * The phone frame.
   *
   * A phone gives the map about 360px, and the wide frame spends it on six
   * columns of stations: the labels land at six unreadable pixels. The fix is
   * not smaller type, it is fewer columns — so the whole map turns a quarter
   * clockwise and the registry's six west-to-east columns become six rows read
   * down the screen the way a phone is held.
   *
   * The turn is baked into the coordinates rather than applied as an SVG
   * transform, because a transform would rotate the land's drop shadow with it
   * and light the island from the side.
   */
  var COMPACT_FRAME_SIZE = { width: 76, height: 104 };
  var COMPACT_CENTRE = { x: 38, y: 50.5 };
  var COMPACT_SCALE = 1.12;

  function toCompact(point) {
    return {
      x: COMPACT_CENTRE.x - COMPACT_SCALE * (point.y - ISLAND_CENTRE.y),
      y: COMPACT_CENTRE.y + COMPACT_SCALE * (point.x - ISLAND_CENTRE.x),
    };
  }

  var COMPACT_SPAN = { x0: 12.5, x1: 62.5, y0: 5, y1: 97 };

  function placeCompact(agent, hq) {
    var x = COMPACT_SPAN.x1 - (clamp(agent.map.y, 0, 70) / 70) * (COMPACT_SPAN.x1 - COMPACT_SPAN.x0);
    var y = COMPACT_SPAN.y0 + (clamp(agent.map.x, 0, 100) / 100) * (COMPACT_SPAN.y1 - COMPACT_SPAN.y0);
    // The backstop for a registry coordinate this span was not drawn around:
    // hold every station where two lines of its label still fit above the
    // frame's bottom edge. The capital's ceiling is lower because its label
    // hangs off a larger circle and so starts further down.
    if (hq) return { x: clamp(x, 10, 66), y: clamp(y, 6, 91.5) };
    return { x: clamp(x, 10, 66), y: clamp(y, 6, 92.7) };
  }

  var WIDE_FRAME = {
    width: 100,
    height: 70,
    centre: ISLAND_CENTRE,
    shore: SHORE,
    grass: GRASS,
    place: placeWide,
  };

  var COMPACT_FRAME = {
    width: COMPACT_FRAME_SIZE.width,
    height: COMPACT_FRAME_SIZE.height,
    centre: COMPACT_CENTRE,
    shore: mapPath(SHORE, toCompact),
    grass: mapPath(GRASS, toCompact),
    place: placeCompact,
  };

  /** The same width the stylesheet steps the map's label type up at. A viewBox
   *  cannot be swapped from a media query, so the frame is chosen here — but the
   *  two have to change together, because the taller type is exactly what the
   *  wide frame has no room for. */
  var compactQuery = window.matchMedia('(max-width: 560px)');

  function trailPath(from, to) {
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    // Bowing every trail the same way round its midpoint keeps two agents that
    // link in both directions from drawing one line twice.
    var bow = Math.min(7, length * 0.16);
    var cx = (from.x + to.x) / 2 - (dy / length) * bow;
    var cy = (from.y + to.y) / 2 + (dx / length) * bow;
    return 'M' + n(from.x) + ' ' + n(from.y) + ' Q' + n(cx) + ' ' + n(cy) + ' ' + n(to.x) + ' ' + n(to.y);
  }

  /** Two short lines sit under a station far better than one long one. The full
   *  name is still on the station's own label and tooltip. */
  function nameLines(name) {
    var words = name.replace(/\s+agents?$/i, '').split(/\s+/).filter(Boolean);
    var lines = [];
    var current = '';
    for (var i = 0; i < words.length; i += 1) {
      var candidate = current ? current + ' ' + words[i] : words[i];
      if (current && candidate.length > 11) {
        lines.push(current);
        current = words[i];
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= 2) return lines;
    return [lines[0] || '', (lines[1] || '') + '…'];
  }

  var mapSeq = 0;

  /**
   * One map instance.
   *
   * It is built once and then painted in place rather than re-rendered, because
   * the state ring, the working pulse and the travelling packet are CSS
   * animations: tearing the SVG down on every event would restart all three
   * several times a second, which is the one thing a quiet diagram must not do.
   */
  function createMap(config) {
    var settings = config || {};
    var uid = 'island' + (mapSeq += 1);
    var root = h('div', { 'class': 'island-map' });
    var live = h('p', { 'class': 'sr-only', 'aria-live': 'polite' });
    var current = { agents: [], states: {}, transfer: null, selected: null };
    var built = null;

    function stateOf(agentId) {
      return current.states[agentId] || 'waiting';
    }

    function layoutOf(frame) {
      var nodes = current.agents.map(function (agent) {
        var hq = agent.id === HQ_AGENT_ID;
        return { agent: agent, point: frame.place(agent, hq), hq: hq };
      });
      var points = {};
      nodes.forEach(function (node) {
        points[node.agent.id] = node.point;
      });
      var trails = [];
      nodes.forEach(function (node) {
        (node.agent.dependsOn || []).forEach(function (dependency) {
          var from = points[dependency];
          // A dependency the merchant switched off simply has no trail.
          if (!from) return;
          trails.push({ key: dependency + '->' + node.agent.id, d: trailPath(from, node.point) });
        });
      });
      return { nodes: nodes, points: points, trails: trails };
    }

    function stationClasses(agent) {
      var classes = ['island-hut', 'island-hut--' + stateOf(agent.id)];
      if (current.selected === agent.id) classes.push('is-selected');
      if (settings.onSelect) classes.push('is-interactive');
      return classes.join(' ');
    }

    function stationLabel(agent) {
      var state = stateOf(agent.id);
      return agent.name + ', ' + STAGE_LABEL[agent.stage] + ' stage, ' +
        (AGENT_STATE_LABEL[state] || state).toLowerCase();
    }

    function buildStation(node) {
      var agent = node.agent;
      var r = node.hq ? HQ_R : STATION_R;
      // The glyph fills 55% of the disc, and the badge straddles the ring on the
      // upper-right diagonal, which is the one quarter no label ever reaches.
      var glyph = round(r * 1.1);
      var badgeAt = round(r * 0.72);

      var title = sv('title');
      var badge = sv('g', { 'aria-hidden': 'true' });

      var group = sv('g', {
        'data-agent': agent.id,
        'data-stage': agent.stage,
        transform: 'translate(' + n(node.point.x) + ' ' + n(node.point.y) + ')',
        role: settings.onSelect ? 'button' : 'img',
        tabindex: settings.onSelect ? '0' : null,
      }, [
        title,
        // `island-hut--hq` marks the capital in ink, and it is scoped to the
        // rings alone: on the whole station it would repaint the state badge in
        // ink too, and one finished mission would show green ticks on eight
        // stations and a black one on the ninth.
        sv('g', { 'class': node.hq ? 'island-hut--hq' : null }, [
          sv('circle', { 'class': 'island-hut__focus', r: round(r + FOCUS_GAP) }),
          sv('circle', { 'class': 'island-hut__halo', r: round(r + HALO_GAP) }),
          sv('circle', { 'class': 'island-hut__pulse', r: round(r + RING_GAP) }),
          sv('circle', { 'class': 'island-hut__disc', r: r }),
          // The ring paints after the disc because the ring is the state, and
          // state has to be the thing that survives being overlapped.
          sv('circle', { 'class': 'island-hut__ring', r: round(r + RING_GAP) }),
          node.hq
            // A capital is marked with a ring and a filled centre, not with a
            // picture of a building.
            ? sv('circle', { 'class': 'island-hut__core', r: 1.5 })
            : sv('g', { transform: 'translate(' + n(-glyph / 2) + ' ' + n(-glyph / 2) + ')' },
              agentGlyph(agent.id, glyph, 'island-hut__glyph')),
        ]),
        badge,
      ]);

      if (settings.onSelect) {
        group.addEventListener('click', function () {
          settings.onSelect(agent.id);
        });
        group.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
          // Space scrolls the page unless we claim it.
          event.preventDefault();
          settings.onSelect(agent.id);
        });
      }

      return { group: group, title: title, badge: badge, badgeAt: badgeAt, agent: agent };
    }

    function paintStation(station) {
      var agent = station.agent;
      var state = stateOf(agent.id);
      station.group.setAttribute('class', stationClasses(agent));
      station.group.setAttribute('aria-label', stationLabel(agent));
      if (settings.onSelect) {
        station.group.setAttribute('aria-pressed', current.selected === agent.id ? 'true' : 'false');
      }
      station.title.textContent = agent.name + ' — ' + (AGENT_STATE_LABEL[state] || state) + '. ' + agent.summary;

      var mark = STATE_BADGE[state];
      clear(station.badge);
      if (!mark) return;
      append(station.badge, [
        sv('circle', {
          'class': 'island-hut__badge-disc',
          cx: n(station.badgeAt),
          cy: n(-station.badgeAt),
          r: BADGE_R,
        }),
        sv('text', {
          'class': 'island-hut__badge-mark',
          x: n(station.badgeAt),
          y: n(-station.badgeAt),
          text: mark,
        }),
      ]);
    }

    function buildLabel(node) {
      var agent = node.agent;
      var classes = ['island-hut__name'];
      if (node.hq) classes.push('island-hut__name--hq');
      if (stateOf(agent.id) === 'skipped') classes.push('island-hut__name--dim');
      var y = node.point.y + (node.hq ? HQ_R : STATION_R) + LABEL_DROP;

      return sv('text', {
        'class': classes.join(' '),
        'data-label': agent.id,
        x: n(node.point.x),
        y: n(y),
      }, nameLines(agent.name).map(function (line, index) {
        // Leading is set in em so the phone type bump moves the second line with
        // the first instead of crowding it.
        return sv('tspan', { x: n(node.point.x), dy: index === 0 ? 0 : LABEL_LEADING, text: line });
      }));
    }

    function paintTransfer() {
      if (!built) return;
      var transfer = null;
      if (current.transfer) {
        var from = built.layout.points[current.transfer.from];
        var to = built.layout.points[current.transfer.to];
        if (from && to) {
          transfer = { key: current.transfer.from + '->' + current.transfer.to, d: trailPath(from, to) };
        }
      }

      Object.keys(built.trails).forEach(function (key) {
        built.trails[key].setAttribute(
          'class',
          'island-map__trail' + (transfer && transfer.key === key ? ' island-map__trail--active' : ''),
        );
      });

      // Replaced wholesale rather than retargeted: a new hand-off is a new
      // journey, and its dash and its disc should both start at the beginning.
      if (built.packetKey === (transfer ? transfer.key : null)) return;
      built.packetKey = transfer ? transfer.key : null;
      clear(built.packet);
      if (!transfer) return;
      append(built.packet, [
        sv('path', { 'class': 'island-map__packet-trail', d: transfer.d, pathLength: 100 }),
        sv('g', { 'class': 'island-map__packet-dot', style: "offset-path: path('" + transfer.d + "')" }, [
          sv('circle', { 'class': 'island-map__packet-halo', r: 2.4, fill: 'url(#' + uid + '-glow)' }),
          sv('circle', { 'class': 'island-map__packet-disc island-map__packet-box', r: 1.1 }),
        ]),
      ]);
    }

    function paintSummary() {
      if (!built) return;
      var counts = {};
      var busy = [];
      var names = {};
      current.agents.forEach(function (agent) {
        names[agent.id] = agent.name;
        var state = stateOf(agent.id);
        counts[state] = (counts[state] || 0) + 1;
        if (state === 'working' || state === 'retrying') busy.push(agent.name);
      });

      var done = counts.completed || 0;
      var tally = SUMMARY_ORDER.filter(function (state) {
        return (counts[state] || 0) > 0;
      }).map(function (state) {
        return counts[state] + ' ' + AGENT_STATE_LABEL[state].toLowerCase();
      }).join(', ');

      var handing = current.transfer
        ? (names[current.transfer.from] || current.transfer.from) + ' is handing work to ' +
          (names[current.transfer.to] || current.transfer.to) + '.'
        : '';

      built.svg.setAttribute('aria-label', current.agents.length
        ? 'Island map of ' + current.agents.length + ' agents: ' + tally + '.' +
          (busy.length ? ' Working now: ' + busy.join(', ') + '.' : '') + (handing ? ' ' + handing : '')
        : 'Island map. No agents are on this mission.');

      // A changing aria-label on role="img" is not re-announced, so progress
      // gets its own polite region.
      live.textContent = current.agents.length
        ? done + ' of ' + current.agents.length + ' agents complete.' +
          (busy.length ? ' ' + busy.join(' and ') + ' working.' : '') + (handing ? ' ' + handing : '')
        : 'No agents on this mission.';
    }

    function build() {
      var frame = compactQuery.matches ? COMPACT_FRAME : WIDE_FRAME;
      var layout = layoutOf(frame);

      var trails = {};
      var trailNodes = layout.trails.map(function (trail) {
        var node = sv('path', { 'class': 'island-map__trail', d: trail.d });
        trails[trail.key] = node;
        return node;
      });

      var stations = layout.nodes.map(buildStation);
      var packet = sv('g', { 'class': 'island-map__packet', 'aria-hidden': 'true' });

      var svgEl = sv('svg', {
        'class': 'island-map__svg',
        viewBox: '0 0 ' + frame.width + ' ' + frame.height,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
      }, [
        sv('defs', null, [
          // Gradient and filter ids are document-global, so two maps on one page
          // would otherwise share — and fight over — the same paint.
          sv('linearGradient', { id: uid + '-sea', x1: '0', y1: '0', x2: '0', y2: '1' }, [
            sv('stop', { 'class': 'island-map__stop--sea-top', offset: '0' }),
            sv('stop', { 'class': 'island-map__stop--sea-deep', offset: '1' }),
          ]),
          sv('linearGradient', { id: uid + '-shore', x1: '0', y1: '0', x2: '0', y2: '1' }, [
            sv('stop', { 'class': 'island-map__stop--shore-top', offset: '0' }),
            sv('stop', { 'class': 'island-map__stop--shore-deep', offset: '1' }),
          ]),
          sv('linearGradient', { id: uid + '-land', x1: '0.1', y1: '0', x2: '0.9', y2: '1' }, [
            sv('stop', { 'class': 'island-map__stop--land-top', offset: '0' }),
            sv('stop', { 'class': 'island-map__stop--land-deep', offset: '1' }),
          ]),
          sv('radialGradient', { id: uid + '-glow' }, [
            sv('stop', { 'class': 'island-map__stop--glow-in', offset: '0' }),
            sv('stop', { 'class': 'island-map__stop--glow-out', offset: '1' }),
          ]),
          sv('filter', { id: uid + '-lift', x: '-25%', y: '-25%', width: '150%', height: '150%' },
            sv('feDropShadow', {
              'class': 'island-map__lift',
              dx: '0',
              dy: '1.6',
              stdDeviation: '2.6',
              'flood-color': '#000000',
              'flood-opacity': '0.12',
            })),
        ]),

        sv('rect', {
          'class': 'island-map__sea',
          x: '0',
          y: '0',
          width: frame.width,
          height: frame.height,
          fill: 'url(#' + uid + '-sea)',
        }),

        // Bathymetry: the coastline stepped outwards once, and only far enough
        // that the ring still closes inside the frame. One hairline is the whole
        // suggestion of water — there is no drawing of a sea here.
        sv('g', { 'class': 'island-map__waves', 'aria-hidden': 'true' }, DEPTH_SCALES.map(function (scale) {
          return sv('path', {
            'class': 'island-map__wave',
            d: frame.shore,
            transform: concentric(frame.centre, scale),
          });
        })),

        // The shore path exists only to cast the shadow: the land is drawn on top
        // of it with the same outline, so its own fill never shows.
        sv('path', {
          'class': 'island-map__shore',
          d: frame.shore,
          fill: 'url(#' + uid + '-shore)',
          filter: 'url(#' + uid + '-lift)',
        }),
        sv('path', { 'class': 'island-map__land', d: frame.shore, fill: 'url(#' + uid + '-land)' }),

        sv('g', { 'class': 'island-map__contours', 'aria-hidden': 'true' }, CONTOUR_SCALES.map(function (scale) {
          return sv('path', {
            'class': 'island-map__contour',
            d: frame.grass,
            transform: concentric(frame.centre, scale),
          });
        })),

        sv('g', { 'class': 'island-map__trails', 'aria-hidden': 'true' }, trailNodes),
        packet,
        sv('g', null, stations.map(function (station) {
          return station.group;
        })),

        // Names paint last so a neighbouring station can never bury one. They
        // repeat what each station's own label already says.
        sv('g', { 'class': 'island-map__labels', 'aria-hidden': 'true' }, layout.nodes.map(buildLabel)),
      ]);

      built = {
        svg: svgEl,
        frame: frame,
        layout: layout,
        stations: stations,
        trails: trails,
        packet: packet,
        packetKey: undefined,
        crew: current.agents.map(function (agent) {
          return agent.id;
        }).join(','),
      };

      fill(root, [svgEl, live]);
      stations.forEach(paintStation);
      paintTransfer();
      paintSummary();
    }

    function update(next) {
      current = {
        agents: next.agents || [],
        states: next.states || {},
        transfer: next.activeTransfer || null,
        selected: next.selected === undefined ? current.selected : next.selected,
      };
      var crew = current.agents.map(function (agent) {
        return agent.id;
      }).join(',');
      if (!built || built.crew !== crew || built.frame !== (compactQuery.matches ? COMPACT_FRAME : WIDE_FRAME)) {
        build();
        return;
      }
      built.stations.forEach(paintStation);
      // The label's dim modifier is the one thing outside a station group that
      // carries state, so it is repainted with them.
      built.layout.nodes.forEach(function (node) {
        var text = built.svg.querySelector('[data-label="' + node.agent.id + '"]');
        if (!text) return;
        var classes = ['island-hut__name'];
        if (node.hq) classes.push('island-hut__name--hq');
        if (stateOf(node.agent.id) === 'skipped') classes.push('island-hut__name--dim');
        text.setAttribute('class', classes.join(' '));
      });
      paintTransfer();
      paintSummary();
    }

    function reframe() {
      if (built) build();
    }

    if (compactQuery.addEventListener) compactQuery.addEventListener('change', reframe);
    else if (compactQuery.addListener) compactQuery.addListener(reframe);

    return { node: root, update: update };
  }

  /* --- engine adapter ------------------------------------------------------ */

  /**
   * The engine is a sibling file written to the same contract, but a method it
   * turns out not to have must degrade to a disabled control rather than to a
   * thrown page. Every call goes through here.
   */
  function engineFn(names) {
    if (!engine) return null;
    for (var i = 0; i < names.length; i += 1) {
      if (typeof engine[names[i]] === 'function') return engine[names[i]].bind(engine);
    }
    return null;
  }

  function describeError(caught) {
    if (!caught) return 'Something went wrong.';
    if (typeof caught === 'string') return caught;
    if (caught.code === 'not_granted') {
      return 'This viewer has not allowed the page to call Claude, so no mission can run here.';
    }
    if (caught.code === 'rate_limited') {
      return 'Claude is rate-limiting this viewer. Wait a moment before starting another mission.';
    }
    return caught.message || 'Something went wrong.';
  }

  /** The engine may hand back a bare mission record or a whole package; the page
   *  reads one shape either way. */
  function asPackage(value) {
    if (!value) return null;
    var mission = value.mission || value;
    return {
      mission: mission,
      runs: value.runs || [],
      events: value.events || [],
      sources: value.sources || [],
      verifications: value.verifications || [],
      corrections: value.corrections || [],
    };
  }

  function mergeEvents(current, incoming) {
    var seen = {};
    var out = [];
    function take(event) {
      if (!event) return;
      var key = event.id || (event.type + ':' + event.seq);
      if (seen[key]) return;
      seen[key] = true;
      out.push(event);
    }
    (current || []).forEach(take);
    (incoming || []).forEach(take);
    out.sort(function (a, b) {
      return (a.seq || 0) - (b.seq || 0);
    });
    return out;
  }

  /* --- page state ---------------------------------------------------------- */

  var state = {
    view: 'control',
    caps: { sample: true, db: true, label: '' },
    picked: {},
    mode: 'auto',
    controlSelected: null,
    pkg: null,
    events: [],
    open: {},
    missionSelected: null,
    missions: null,
    historyFilter: 'all',
    historyError: null,
    controlError: null,
    missionError: null,
    busy: null,
    starting: false,
  };

  var controlRefs = null;
  var controlMap = null;
  var missionMap = null;
  var missionRefs = null;
  var renderQueued = false;
  var refreshTimer = null;

  function coreAgents() {
    return ROSTER.filter(function (agent) {
      return agent.core;
    });
  }

  function optionalAgents() {
    return ROSTER.filter(function (agent) {
      return !agent.core;
    });
  }

  function agentById(id) {
    for (var i = 0; i < ROSTER.length; i += 1) {
      if (ROSTER[i].id === id) return ROSTER[i];
    }
    return null;
  }

  function agentName(id) {
    var agent = agentById(id);
    return agent ? agent.name : humanise(id);
  }

  function chosenAgents() {
    return ROSTER.filter(function (agent) {
      return agent.core || state.picked[agent.id] === true;
    }).map(function (agent) {
      return agent.id;
    });
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  function show(view) {
    state.view = view;
    byId('screen-control').hidden = view !== 'control';
    byId('screen-mission').hidden = view !== 'mission';
    byId('screen-history').hidden = view !== 'history';
    var links = byId('app-links').querySelectorAll('.app__link');
    for (var i = 0; i < links.length; i += 1) {
      var target = links[i].getAttribute('data-view');
      // Mission control and a mission are two views of one place in the nav.
      if (target === (view === 'mission' ? 'control' : view)) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
    scheduleRender();
  }

  /* --- mission control ----------------------------------------------------- */

  function buildControl() {
    var task = h('textarea', {
      'class': 'textarea',
      rows: 5,
      placeholder: 'e.g. Should I open a speciality coffee shop in Galway city centre? I have €60,000 and no hospitality experience.',
      required: true,
    });
    var objective = h('input', { 'class': 'input', placeholder: 'Decide whether to sign the lease before March' });
    var geography = h('input', { 'class': 'input', placeholder: 'Galway, Ireland' });
    var currency = h('input', { 'class': 'input mono', placeholder: 'EUR', maxlength: 3 });
    var constraints = h('textarea', {
      'class': 'textarea',
      rows: 3,
      placeholder: 'Budget under €60,000\nMust open within 9 months',
    });

    currency.addEventListener('input', function () {
      currency.value = currency.value.toUpperCase();
    });
    task.addEventListener('input', syncControl);

    var count = hint('');
    var startButton = h('button', { 'class': 'btn btn--lg', type: 'submit', text: 'Start mission' });
    var errorSlot = h('div');
    var modeBody = small('', true);
    var modeTabs = h('div', { 'class': 'tabs', role: 'tablist', 'aria-label': 'Mission mode' }, MODES.map(function (option) {
      return h('button', {
        type: 'button',
        role: 'tab',
        'class': 'tab',
        'data-mode': option.value,
        text: option.title,
        onclick: function () {
          state.mode = option.value;
          syncControl();
        },
      });
    }));

    var corePills = h('div', { 'class': 'row row--wrap' }, coreAgents().map(function (agent) {
      return h('span', { 'class': 'pill pill--brand', title: agent.summary, text: agent.name });
    }));

    var agentGrid = h('div', { 'class': 'agent-grid' }, optionalAgents().map(function (agent) {
      var input = h('input', {
        'class': 'switch__input',
        type: 'checkbox',
        onchange: function () {
          state.picked[agent.id] = input.checked;
          syncControl();
        },
      });
      return h('label', { 'class': 'agent-card', 'data-agent': agent.id }, [
        h('span', { 'class': 'agent-card__head' }, [
          h('span', { 'class': 'agent-card__emoji', 'aria-hidden': 'true' }, agentGlyph(agent.id, 18)),
          h('span', { 'class': 'grow' }, [
            h('span', { 'class': 'agent-card__name', text: agent.name }),
            h('span', { 'class': 'agent-card__role', text: STAGE_LABEL[agent.stage] + ' · ' + agent.role }),
          ]),
          h('span', { 'class': 'switch' }, [
            input,
            h('span', { 'class': 'switch__track' }, h('span', { 'class': 'switch__knob' })),
          ]),
        ]),
        h('p', { 'class': 'agent-card__body', text: agent.summary }),
      ]);
    }));

    controlMap = createMap({
      onSelect: function (agentId) {
        state.controlSelected = state.controlSelected === agentId ? null : agentId;
        syncControl();
      },
    });

    var mapHint = hint('Select a station to read what that agent does.');
    var capacityNote = h('div');
    var forexNote = h('div');

    var form = h('form', { 'class': 'stack stack--lg', onsubmit: submitMission }, [
      h('div', { 'class': 'card card--sea launch' }, [
        heading('The question'),
        h('label', { 'class': 'field' }, [
          h('span', { 'class': 'sr-only', text: 'The question' }),
          task,
          hint('Write it the way you would ask a person. The Task Manager turns it into a plan and picks the agents the question actually needs.'),
        ]),
        h('div', { 'class': 'row row--between row--wrap' }, [count, startButton]),
        errorSlot,
      ]),

      h('div', { 'class': 'grid grid--2' }, [
        h('div', { 'class': 'card stack' }, [heading('Run mode'), modeTabs, modeBody]),
        h('div', { 'class': 'card stack' }, [
          heading('Context'),
          hint('Optional.'),
          h('div', { 'class': 'grid grid--2' }, [
            h('label', { 'class': 'field' }, [h('span', { 'class': 'field__label', text: 'Geography' }), geography]),
            h('label', { 'class': 'field' }, [h('span', { 'class': 'field__label', text: 'Currency' }), currency]),
          ]),
          h('label', { 'class': 'field' }, [h('span', { 'class': 'field__label', text: 'Objective' }), objective]),
          h('label', { 'class': 'field' }, [
            h('span', { 'class': 'field__label', text: 'Constraints, one per line' }),
            constraints,
          ]),
        ]),
      ]),

      h('section', { 'class': 'stack' }, [
        h('div', { 'class': 'row row--between row--wrap' }, [
          heading('Agents on this mission'),
          hint('Core agents always run. Specialists are switched on for this mission only.'),
        ]),
        corePills,
        agentGrid,
        forexNote,
      ]),
    ]);

    fill(byId('screen-control'), [
      h('div', { 'class': 'page-head' }, [
        h('h1', { 'class': 'page-head__title', text: 'Mission control' }),
        h('p', {
          'class': 'page-head__sub',
          text: 'One task, one island, one audited answer. Every agent works separately, is challenged by the ones that come after it, and — on this hosted island — cannot look anything up.',
        }),
      ]),
      capacityNote,
      form,
      h('section', { 'class': 'card stack' }, [
        h('div', { 'class': 'row row--between row--wrap' }, [heading('The island'), mapHint]),
        controlMap.node,
      ]),
    ]);

    controlRefs = {
      task: task,
      objective: objective,
      geography: geography,
      currency: currency,
      constraints: constraints,
      count: count,
      startButton: startButton,
      errorSlot: errorSlot,
      modeTabs: modeTabs,
      modeBody: modeBody,
      agentGrid: agentGrid,
      mapHint: mapHint,
      capacityNote: capacityNote,
      forexNote: forexNote,
      form: form,
    };
  }

  /** Everything on mission control that changes without the page being rebuilt. */
  function syncControl() {
    if (!controlRefs) return;
    var chosen = chosenAgents();
    var mode = MODES.filter(function (option) {
      return option.value === state.mode;
    })[0] || MODES[0];
    var mayStart = state.caps.sample !== false && Boolean(engineFn(['startMission', 'createMission', 'run', 'start']));

    controlRefs.count.textContent = plural(chosen.length, 'agent') + ' · ' + mode.title.toLowerCase();
    controlRefs.modeBody.textContent = mode.body;
    controlRefs.startButton.disabled = !mayStart || state.starting || !controlRefs.task.value.trim();
    controlRefs.startButton.textContent = state.starting ? 'Starting…' : 'Start mission';

    var tabs = controlRefs.modeTabs.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-mode') === state.mode ? 'true' : 'false');
      tabs[i].disabled = !mayStart;
    }

    ['task', 'objective', 'geography', 'currency', 'constraints'].forEach(function (key) {
      controlRefs[key].disabled = !mayStart;
    });

    var cards = controlRefs.agentGrid.querySelectorAll('.agent-card');
    for (var j = 0; j < cards.length; j += 1) {
      var id = cards[j].getAttribute('data-agent');
      var on = state.picked[id] === true;
      cards[j].setAttribute('class', 'agent-card' + (on ? ' is-selected' : ' agent-card--off'));
      var input = cards[j].querySelector('.switch__input');
      input.checked = on;
      input.disabled = !mayStart;
    }

    fill(controlRefs.errorSlot, state.controlError ? errorNote(state.controlError) : null);
    fill(controlRefs.capacityNote, capabilityNotices());

    // Said before the mission runs rather than only in the report: the currency
    // agents are the ones whose whole job is a number this island cannot get.
    var forexOn = FOREX_AGENTS.filter(function (id) {
      return state.picked[id] === true;
    });
    fill(controlRefs.forexNote, forexOn.length > 0
      ? h('div', { 'class': 'sim-notice', role: 'alert' }, [
        alertMark(17),
        h('div', { 'class': 'stack stack--sm' }, [
          h('strong', { text: 'The currency agents cannot see a price.' }),
          h('span', {
            text: plural(forexOn.length, 'currency agent') + ' switched on for this mission — ' +
              forexOn.map(agentName).join(', ') + '. There is no price feed here and no way to ' +
              'reach one, so every rate, level, spread and target they produce will be recalled ' +
              'from training data and may be years out of date. Use them to shape a question, ' +
              'never to take a position.',
          }),
        ]),
      ])
      : null);

    var selected = state.controlSelected ? agentById(state.controlSelected) : null;
    controlRefs.mapHint.textContent = selected
      ? selected.summary
      : 'Select a station to read what that agent does.';

    // The idle map previews the crew: whoever is on this mission waits at their
    // station, whoever is switched off is greyed out as skipped.
    var sailing = {};
    chosen.forEach(function (id) {
      sailing[id] = true;
    });
    var states = {};
    ROSTER.forEach(function (agent) {
      states[agent.id] = sailing[agent.id] ? 'waiting' : 'skipped';
    });
    controlMap.update({
      agents: ROSTER,
      states: states,
      activeTransfer: null,
      selected: state.controlSelected,
    });
  }

  /** The two ways this hosted island can be less than itself, said out loud
   *  rather than left as an empty screen. */
  function capabilityNotices() {
    var out = [];
    if (!engine) {
      out.push(errorNote('The mission engine did not load on this page, so nothing can be run. The roster below is the real one, read-only.'));
    } else if (state.caps.sample === false) {
      out.push(h('div', { 'class': 'sim-notice', role: 'alert' }, [
        alertMark(17),
        h('div', { 'class': 'stack stack--sm' }, [
          h('strong', { text: 'This viewer cannot call Claude, so no mission can run here.' }),
          h('span', {
            text: 'Every agent on this island is a Claude call made on the viewer\'s own account. ' +
              'Without it the island has nothing to run, so the roster below is read-only: the real ' +
              'prompts and schemas, with the controls switched off.',
          }),
        ]),
      ]));
    }
    if (engine && state.caps.db === false) {
      out.push(h('div', { 'class': 'alert', role: 'status' }, [
        h('span', { 'class': 'row' }, [
          alertMark(16),
          h('span', {
            text: 'No storage is available to this page, so missions last only for this session. ' +
              'Reload the page and everything below is gone.',
          }),
        ]),
      ]));
    }
    return out;
  }

  function submitMission(event) {
    event.preventDefault();
    var startFn = engineFn(['startMission', 'createMission', 'run', 'start']);
    var task = controlRefs.task.value.trim();
    if (!task || state.starting || !startFn) return;

    state.starting = true;
    state.controlError = null;
    syncControl();

    Promise.resolve(startFn({
      task: task,
      objective: controlRefs.objective.value.trim(),
      geography: controlRefs.geography.value.trim(),
      currency: controlRefs.currency.value.trim().toUpperCase(),
      constraints: controlRefs.constraints.value.split('\n').map(function (line) {
        return line.trim();
      }).filter(Boolean),
      agents: chosenAgents(),
      mode: state.mode,
    })).then(function (result) {
      state.starting = false;
      var pkg = asPackage(result);
      if (!pkg) {
        state.controlError = 'The engine started a mission but returned nothing to show.';
        syncControl();
        return;
      }
      openMission(pkg);
    }).catch(function (caught) {
      state.starting = false;
      state.controlError = describeError(caught);
      syncControl();
    });
  }

  /* --- a mission ----------------------------------------------------------- */

  function openMission(pkg) {
    state.pkg = pkg;
    state.events = mergeEvents([], pkg.events);
    state.open = {};
    state.missionSelected = null;
    state.missionError = null;
    missionRefs = null;
    missionMap = null;
    show('mission');
  }

  function missionCrew() {
    var mission = state.pkg && state.pkg.mission;
    var wanted = {};
    (mission && mission.enabledAgents ? mission.enabledAgents : []).forEach(function (id) {
      wanted[id] = true;
    });
    var sailing = ROSTER.filter(function (agent) {
      return wanted[agent.id];
    });
    return sailing.length > 0 ? sailing : ROSTER.filter(function (agent) {
      return agent.enabledByDefault;
    });
  }

  /** The most recent run per agent: a retry and a correction round are separate rows. */
  function latestRuns() {
    var runs = {};
    (state.pkg ? state.pkg.runs : []).forEach(function (run) {
      var current = runs[run.agentId];
      if (!current || String(run.startedAt) >= String(current.startedAt)) runs[run.agentId] = run;
    });
    return runs;
  }

  function agentStates(crew, runs) {
    var states = {};
    crew.forEach(function (agent) {
      states[agent.id] = 'waiting';
    });
    Object.keys(runs).forEach(function (id) {
      states[id] = runs[id].status;
    });
    // Events arrive live where the stored runs are one refresh behind, so they win.
    state.events.forEach(function (event) {
      var next = EVENT_STATE[event.type];
      if (next && event.agentId) states[event.agentId] = next;
    });
    return states;
  }

  function activeTransfer(crew, states) {
    var target = null;
    for (var c = 0; c < crew.length; c += 1) {
      if (states[crew[c].id] === 'working') {
        target = crew[c].id;
        break;
      }
    }
    if (!target) return null;
    for (var i = state.events.length - 1; i >= 0; i -= 1) {
      var event = state.events[i];
      if (!event) continue;
      var payload = event.payload || {};
      if (event.type === 'handoff' && payload.to === target) {
        var from = payload.from || event.agentId;
        if (from) return { from: from, to: target };
      }
      // No hand-off announced yet: the packet still came from whoever just finished.
      if (event.type === 'agent_completed' && event.agentId && event.agentId !== target) {
        return { from: event.agentId, to: target };
      }
    }
    return null;
  }

  function buildMissionShell() {
    missionMap = createMap({
      onSelect: function (agentId) {
        state.missionSelected = state.missionSelected === agentId ? null : agentId;
        state.open[agentId] = !state.open[agentId];
        scheduleRender();
      },
    });

    var islandHint = hint('Select a station to open that agent’s work.');
    var refs = {
      head: h('div', { 'class': 'stack' }),
      rail: h('div'),
      stats: h('div', { 'class': 'grid grid--4' }),
      warnings: h('div', { 'class': 'card stack' }),
      islandHint: islandHint,
      agents: h('section', { 'class': 'stack' }),
      narration: h('div', { 'class': 'split split--even' }),
      verification: h('div'),
      sources: h('div'),
      report: h('div', { 'class': 'stack stack--lg' }),
    };

    fill(byId('screen-mission'), [
      refs.head,
      refs.rail,
      refs.stats,
      refs.warnings,
      h('section', { 'class': 'card stack' }, [
        h('div', { 'class': 'row row--between row--wrap' }, [heading('The island'), islandHint]),
        missionMap.node,
      ]),
      refs.agents,
      refs.narration,
      refs.verification,
      refs.sources,
      refs.report,
    ]);

    missionRefs = refs;
  }

  function renderMission() {
    var pkg = state.pkg;
    if (!pkg) {
      fill(byId('screen-mission'), empty('No mission open', 'Start one from mission control.'));
      missionRefs = null;
      return;
    }
    if (!missionRefs) buildMissionShell();

    var mission = pkg.mission;
    var crew = missionCrew();
    var runs = latestRuns();
    var states = agentStates(crew, runs);
    var transfer = activeTransfer(crew, states);
    var live = Boolean(LIVE[mission.status]);

    var working = crew.filter(function (agent) {
      return states[agent.id] === 'working';
    });
    var completed = crew.filter(function (agent) {
      return states[agent.id] === 'completed';
    }).length;
    var remaining = crew.length - completed;
    var progress = crew.length === 0 ? 0 : Math.round((completed / crew.length) * 100);

    renderMissionHead(mission, live);
    renderStageRail(crew, states, mission.currentStage);
    renderMissionStats(mission, crew, working, completed, remaining, progress, runs, live);
    renderWarnings(crew, states, runs);

    missionRefs.islandHint.textContent = transfer
      ? 'Handing off: ' + agentName(transfer.from) + ' → ' + agentName(transfer.to)
      : 'Select a station to open that agent’s work.';
    missionMap.update({
      agents: crew,
      states: states,
      activeTransfer: transfer,
      selected: state.missionSelected,
    });

    fill(missionRefs.agents, [
      heading('What each agent found'),
      crew.map(function (agent) {
        return agentPanel(agent, runs[agent.id] || null, states[agent.id] || 'waiting');
      }),
    ]);

    fill(missionRefs.narration, [timelinePanel(), auditPanel()]);
    fill(missionRefs.verification, verificationPanel(runs));
    fill(missionRefs.sources, sourcePanel());
    fill(missionRefs.report, mission.finalReport ? reportView(mission, mission.finalReport) : null);

    // The moment there is a report it is the thing the reader came for, so it
    // moves above the run's own instrumentation rather than sitting under all of
    // it. Only the block moves — the map stays where it is, because detaching it
    // would restart every animation on the island.
    if (mission.finalReport && !missionRefs.reportHoisted) {
      byId('screen-mission').insertBefore(missionRefs.report, missionRefs.rail);
      missionRefs.reportHoisted = true;
    }
  }

  function renderMissionHead(mission, live) {
    var pauseFn = engineFn(['pauseMission', 'pause']);
    var resumeFn = engineFn(['resumeMission', 'resume']);
    var abortFn = engineFn(['abortMission', 'abort', 'stopMission']);
    var approveFn = engineFn(['approveStage', 'approve']);

    function command(action, fn) {
      if (!fn) return;
      state.busy = action;
      state.missionError = null;
      scheduleRender();
      Promise.resolve(fn(mission.id)).then(function (next) {
        state.busy = null;
        var pkg = asPackage(next);
        if (pkg && pkg.mission && pkg.mission.id === mission.id) state.pkg.mission = pkg.mission;
        scheduleRefresh();
        scheduleRender();
      }).catch(function (caught) {
        state.busy = null;
        state.missionError = describeError(caught);
        scheduleRender();
      });
    }

    var actions = [];
    if (pauseFn && (mission.status === 'running' || mission.status === 'planning')) {
      actions.push(h('button', {
        type: 'button',
        'class': 'btn btn--sm btn--ghost',
        text: state.busy === 'pause' ? 'Pausing…' : 'Pause',
        disabled: state.busy !== null,
        onclick: function () {
          command('pause', pauseFn);
        },
      }));
    }
    if (resumeFn && mission.status === 'paused') {
      actions.push(h('button', {
        type: 'button',
        'class': 'btn btn--sm',
        text: state.busy === 'resume' ? 'Resuming…' : 'Resume',
        disabled: state.busy !== null,
        onclick: function () {
          command('resume', resumeFn);
        },
      }));
    }
    if (abortFn && live) {
      actions.push(h('button', {
        type: 'button',
        'class': 'btn btn--sm btn--danger',
        text: 'Abort',
        disabled: state.busy !== null,
        onclick: function () {
          if (!window.confirm('Stop this mission? Work already done is kept.')) return;
          command('abort', abortFn);
        },
      }));
    }
    actions.push(h('button', {
      type: 'button',
      'class': 'btn btn--sm btn--subtle',
      text: 'All missions',
      onclick: function () {
        loadHistory();
        show('history');
      },
    }));

    fill(missionRefs.head, [
      h('div', { 'class': 'row row--between row--wrap row--top' }, [
        h('div', { 'class': 'page-head' }, [
          h('div', { 'class': 'row row--wrap' }, [
            h('span', { 'class': 'mission-item__ref', text: mission.reference || mission.id }),
            statusPill(mission.status),
            live ? pill('Live', 'pill--positive') : null,
          ]),
          h('h1', { 'class': 'page-head__title page-head__title--task', text: mission.userTask }),
          h('p', { 'class': 'page-head__sub', text: missionSubtitle(mission) }),
        ]),
        h('div', { 'class': 'row row--wrap' }, actions),
      ]),
      mission.objective ? small(mission.objective) : null,
      mission.status === 'awaiting_approval'
        ? h('div', { 'class': 'alert alert--warning row row--between row--wrap', role: 'alert' }, [
          h('span', {
            text: mission.pendingApprovalStage
              ? STAGE_LABEL[mission.pendingApprovalStage] + ' is finished and waiting for you.'
              : 'The island is waiting for your approval before it continues.',
          }),
          approveFn
            ? h('button', {
              type: 'button',
              'class': 'btn btn--sm',
              text: state.busy === 'approve' ? 'Approving…' : 'Approve and continue',
              disabled: state.busy !== null,
              onclick: function () {
                command('approve', approveFn);
              },
            })
            : null,
        ])
        : null,
      state.missionError ? errorNote(state.missionError) : null,
      mission.error ? errorNote(mission.error) : null,
    ]);
  }

  function missionSubtitle(mission) {
    var parts = ['Started ' + formatDateTime(mission.startedAt || mission.createdAt)];
    parts.push(mission.mode === 'approval' ? 'approval gates' : 'automatic');
    if (mission.geography) parts.push(mission.geography);
    if (mission.currency) parts.push(mission.currency);
    return parts.join(' · ');
  }

  function renderStageRail(crew, states, currentStage) {
    var stages = STAGE_ORDER.filter(function (stage) {
      return crew.some(function (agent) {
        return agent.stage === stage;
      });
    });
    if (stages.length === 0) {
      fill(missionRefs.rail, null);
      return;
    }
    fill(missionRefs.rail, h('div', { 'class': 'stage-rail' }, stages.map(function (stage) {
      var members = crew.filter(function (agent) {
        return agent.stage === stage;
      });
      var done = members.every(function (agent) {
        var value = states[agent.id];
        return value === 'completed' || value === 'skipped' || value === 'failed';
      });
      var mark = currentStage === stage ? ' is-current' : done ? ' is-done' : '';
      return h('span', { 'class': 'stage-rail__step' + mark }, [
        h('span', { 'class': 'stage-rail__dot' }),
        STAGE_LABEL[stage],
      ]);
    })));
  }

  function renderMissionStats(mission, crew, working, completed, remaining, progress, runs, live) {
    var finished = crew.length > 0 && remaining === 0;
    var ended = !live;

    // An agent name at 28px wraps to two lines and leaves one card in a four-up
    // row taller than its neighbours. A count always fits; the caption underneath
    // names who is actually working.
    var workingValue = working.length
      ? plural(working.length, 'agent')
      : ended ? 'Finished' : 'Idle';
    var stages = {};
    working.forEach(function (agent) {
      stages[STAGE_LABEL[agent.stage]] = true;
    });
    var workingNote = working.length
      ? working.length === 1 ? working[0].name : Object.keys(stages).join(' · ')
      : ended
        ? mission.status === 'completed' ? 'Every agent has reported' : 'The mission ended early'
        : 'No agent is running';

    var audit = runs.risk_verification && runs.risk_verification.output;
    var passed = audit && typeof audit.verification_passed === 'boolean' ? audit.verification_passed : null;
    var records = state.pkg.verifications || [];
    var unresolved = records.filter(function (record) {
      return !record.resolved;
    });
    var rounds = records.reduce(function (highest, record) {
      return Math.max(highest, record.round || 0);
    }, 0);

    fill(missionRefs.stats, [
      stat('Working now', workingValue, workingNote),
      stat('Completed', completed + '/' + crew.length, remaining === 0 ? 'Nothing left to run' : remaining + ' still to run'),
      stat('Progress', progress + '%', finished
        ? 'All stages done'
        : mission.currentStage
          ? STAGE_LABEL[mission.currentStage]
          : progress > 0 ? 'No stage running' : 'Not started'),
      stat(
        'Verification',
        passed === null ? 'Pending' : passed ? 'Passed' : 'Failed',
        unresolved.length + ' unresolved · ' + plural(rounds, 'round'),
        passed === false ? 'negative' : passed ? 'positive' : null,
      ),
    ]);
  }

  function renderWarnings(crew, states, runs) {
    var warnings = [];
    crew.forEach(function (agent) {
      var value = states[agent.id];
      if (value === 'failed') {
        warnings.push([agent.name + ' failed; the mission continued without it.']);
      }
      if (value === 'retrying') {
        warnings.push([agent.name + ' is retrying after an unusable response.']);
      }
      if (value === 'needs_review') {
        warnings.push([agent.name + ' produced work that needs a human read.']);
      }
    });

    (state.pkg.verifications || []).forEach(function (record) {
      if (record.resolved || record.severity !== 'high') return;
      warnings.push([
        'Unresolved high-severity flag on ',
        h('span', { 'class': 'mono', text: record.findingId }),
        ': ' + record.reason,
      ]);
    });

    (state.pkg.corrections || []).forEach(function (correction) {
      if (correction.resolved) return;
      warnings.push([
        'Open challenge — ' + agentName(correction.fromAgent) + ' → ' + agentName(correction.toAgent) +
          ': ' + correction.reason,
      ]);
    });

    // A finding an agent labelled VERIFIED is a warning in its own right here:
    // it means an agent believed it had checked something it could not have.
    var overclaims = 0;
    Object.keys(runs).forEach(function (id) {
      var output = runs[id].output;
      if (!output || !output.findings) return;
      output.findings.forEach(function (finding) {
        if (finding.label === 'VERIFIED') overclaims += 1;
      });
    });
    if (overclaims > 0) {
      warnings.push([
        plural(overclaims, 'finding') + ' came back marked verified. Nothing on this island can be ' +
          'verified, so each one has been downgraded to needs verification where it appears.',
      ]);
    }

    fill(missionRefs.warnings, warnings.length > 0
      ? h('div', { 'class': 'stack stack--sm' }, [
        eyebrow('Warnings (' + warnings.length + ')'),
        h('ul', { 'class': 'bullets small' }, warnings.map(function (parts) {
          return h('li', null, parts);
        })),
      ])
      : small('No warnings raised so far.', true));
  }

  function agentPanel(agent, run, agentState) {
    var output = run && run.output ? run.output : null;
    var findings = output && output.findings ? output.findings : [];
    var open = state.open[agent.id] === true;

    var extras = [];
    if (output) {
      Object.keys(output).forEach(function (key) {
        if (!CORE_OUTPUT_KEYS[key]) extras.push(key);
      });
    }

    var head = h('button', {
      type: 'button',
      'class': 'agent-card__head grow',
      'aria-expanded': open ? 'true' : 'false',
      // A button has to be stripped back to a plain row before it can wear a
      // card's head, and the head's own rule starts its children at the top —
      // which is where the chevron was stranded. Neither is something the
      // stylesheet says yet.
      style: 'background: none; border: 0; padding: 0; text-align: left; align-items: center',
      onclick: function () {
        state.open[agent.id] = !open;
        scheduleRender();
      },
    }, [
      h('span', { 'class': 'agent-card__emoji', 'aria-hidden': 'true' }, agentGlyph(agent.id, 18)),
      h('span', { 'class': 'grow' }, [
        h('span', { 'class': 'agent-card__name', text: agent.name }),
        h('span', {
          'class': 'agent-card__role',
          text: agent.role + ' · ' + STAGE_LABEL[agent.stage] +
            (run && run.attempt > 1 ? ' · attempt ' + run.attempt : '') +
            (run && run.round > 0 ? ' · correction round ' + run.round : ''),
        }),
      ]),
      agentStatePill(agentState),
      chevron(open),
    ]);

    var body = null;
    if (open) {
      body = h('div', { 'class': 'stack' }, [
        !run ? h('p', { 'class': 'agent-card__body', text: 'This agent has not run yet.' }) : null,
        run && run.error ? errorNote(run.error) : null,

        findings.length > 0
          ? h('div', { 'class': 'stack stack--sm' }, [eyebrow('Findings'), findings.map(findingRow)])
          : null,

        output && output.issues && output.issues.length > 0
          ? h('div', { 'class': 'stack stack--sm' }, [
            eyebrow('Issues it raised'),
            h('ul', { 'class': 'bullets small' }, output.issues.map(function (issue) {
              return h('li', null, [
                // Severity leads in ink rather than in a pink pill: the card
                // already carries a state chip and a label chip, and a third
                // colour for the same claim makes all three mean less.
                h('strong', { text: SEVERITY_LEAD[issue.severity] || humanise(issue.severity) }),
                ' — ' + (issue.target_agent ? agentName(issue.target_agent) : 'its own caveat'),
                issue.target_finding_id ? h('span', { 'class': 'mono', text: ' ' + issue.target_finding_id }) : null,
                ': ' + issue.problem,
                h('div', { 'class': 'source-meta', text: 'Required: ' + issue.required_action }),
              ]);
            })),
          ])
          : null,

        output && output.recommendations && output.recommendations.length > 0
          ? h('div', { 'class': 'stack stack--sm' }, [
            eyebrow('Recommendations'),
            h('ol', { 'class': 'bullets small' }, output.recommendations.slice().sort(function (a, b) {
              return a.priority - b.priority;
            }).map(function (recommendation) {
              return h('li', null, [
                h('strong', { text: recommendation.action }),
                h('div', { 'class': 'source-meta', text: recommendation.reason }),
              ]);
            })),
          ])
          : null,

        output && output.assumptions && output.assumptions.length > 0
          ? h('div', { 'class': 'stack stack--sm' }, [
            eyebrow('Assumptions'),
            bullets(output.assumptions, ''),
          ])
          : null,

        extras.length > 0
          ? h('div', { 'class': 'stack stack--sm' }, [
            eyebrow(agent.name + ' specifics'),
            h('div', { 'class': 'kv' }, extras.reduce(function (out, key) {
              out.push(h('span', { 'class': 'kv__key', text: humanise(key) }));
              out.push(h('span', { 'class': 'kv__value' }, structured(output[key])));
              return out;
            }, [])),
          ])
          : null,

        output && output.next_agent_instructions
          ? h('p', { 'class': 'agent-card__body', text: 'Hand-off note: ' + output.next_agent_instructions })
          : null,

        run && run.notes
          ? rememberedDetails('notes:' + agent.id, 'How it reasoned before shaping its answer',
            h('pre', { 'class': 'prose mono scroller', text: run.notes }))
          : null,

        // The last link in the chain the island promises: recommendation → agent
        // → finding → evidence → and the input the agent was working from when
        // it said it. Held in a details because it contains every upstream
        // agent's full output.
        run && run.input
          ? rememberedDetails('envelope:' + agent.id, 'Exactly what this agent was given',
            h('pre', { 'class': 'prose mono scroller', text: JSON.stringify(run.input, null, 2) }))
          : null,

        run
          ? h('span', {
            'class': 'source-meta',
            text: formatDateTime(run.startedAt) + ' · ' + formatDuration(run.durationMs) +
              (run.inputTokens !== null && run.inputTokens !== undefined
                ? ' · ' + (run.inputTokens || 0) + ' in / ' + (run.outputTokens || 0) + ' out tokens'
                : ''),
          })
          : null,
      ]);
    }

    return h('article', {
      'class': 'agent-card' + (state.missionSelected === agent.id ? ' is-selected' : ''),
    }, [
      h('div', { 'class': 'row' }, [
        head,
        run && typeof run.confidence === 'number'
          ? h('div', { 'class': 'agent-panel__confidence' }, confidenceMeter(run.confidence, 'Agent confidence'))
          : null,
      ]),
      body,
    ]);
  }

  function findingRow(finding) {
    return h('div', { 'class': 'source-item' }, [
      h('span', { 'class': 'source-ref', text: finding.finding_id }),
      h('div', { 'class': 'grow stack stack--sm' }, [
        h('div', { 'class': 'row row--between row--wrap' }, [
          labelChip(finding.label),
          h('span', { 'class': 'source-meta' }, [
            finding.category + ' · importance ' + finding.importance + ' · confidence ',
            h('span', { 'class': 'tabular', text: formatPercent(honestConfidence(finding.confidence)) }),
          ]),
        ]),
        small(finding.claim),
        evidenceList(finding.evidence),
      ]),
    ]);
  }

  /**
   * Evidence, rendered as text rather than as links.
   *
   * The product turns `source_url` into an anchor, which is right when an agent
   * actually opened the page. Here no agent opened anything, so any URL in a
   * finding was recalled or invented — and a blue underlined one would be the
   * page vouching for it. It is printed as the unverified string it is.
   */
  function evidenceList(evidence) {
    if (!evidence || evidence.length === 0) {
      return h('span', {
        'class': 'source-meta',
        text: 'No evidence attached — this claim rests on the model’s own memory.',
      });
    }
    return h('ul', { 'class': 'bullets source-meta' }, evidence.map(function (item) {
      return h('li', null, [
        item.source_title || (item.source_url ? 'Untitled source' : 'No source'),
        item.source_id ? h('span', { 'class': 'mono', text: ' ' + item.source_id }) : null,
        item.support ? ' — ' + item.support : '',
        item.source_url
          ? h('div', { 'class': 'source-meta' }, [
            h('span', { 'class': 'mono', text: item.source_url }),
            ' — not opened. This page cannot reach the web, so treat the address as part of the claim.',
          ])
          : null,
      ]);
    }));
  }

  function timelinePanel() {
    var events = state.events.slice(-250);
    return h('section', { 'class': 'card stack' }, [
      h('div', { 'class': 'row row--between' }, [
        heading('Mission timeline'),
        h('span', { 'class': 'source-meta', text: plural(state.events.length, 'event') }),
      ]),
      events.length === 0
        ? empty('Nothing has happened yet', 'Events appear the moment the island starts work.')
        : h('ol', { 'class': 'timeline scroller' }, events.map(function (event) {
          var tone = TIMELINE_TONE[event.type];
          return h('li', { 'class': 'timeline__item' + (tone ? ' timeline__item--' + tone : '') }, [
            h('span', { 'class': 'timeline__marker' }, h('span', { 'class': 'timeline__dot' })),
            h('span', null, [
              h('p', { 'class': 'timeline__text', text: event.message }),
              h('span', {
                'class': 'timeline__time',
                text: formatTime(event.createdAt) + (event.agentId ? ' · ' + agentName(event.agentId) : ''),
              }),
            ]),
          ]);
        })),
    ]);
  }

  function auditPanel() {
    var corrections = state.pkg.corrections || [];
    var challenges = state.events.filter(function (event) {
      return event.type === 'challenge';
    });

    return h('section', { 'class': 'card stack' }, [
      heading('Challenges and corrections'),
      small('Nothing is fixed silently. Every claim an agent changed after being challenged is here, with what it used to say.', true),

      corrections.length === 0 && challenges.length === 0
        ? empty('No corrections yet', 'No agent has had to correct another on this mission.')
        : null,

      corrections.map(function (correction) {
        return h('div', { 'class': 'source-item' }, [
          h('span', { 'class': 'source-ref', text: correction.findingId }),
          h('div', { 'class': 'grow' }, [
            h('div', { 'class': 'row row--between row--wrap' }, [
              h('span', {
                'class': 'small strong',
                text: agentName(correction.fromAgent) + ' → ' + agentName(correction.toAgent),
              }),
              h('span', { 'class': 'row' }, [
                pill(correction.severity, correction.severity === 'high' ? 'pill--negative' : 'pill--warning'),
                pill('Round ' + correction.round, 'pill--muted'),
                pill(correction.resolved ? 'Resolved' : 'Open', correction.resolved ? 'pill--positive' : 'pill--warning'),
              ]),
            ]),
            h('div', { 'class': 'source-meta', text: 'Was: ' + correction.originalClaim }),
            h('div', { 'class': 'small', text: 'Now: ' + correction.correctedClaim }),
            h('div', { 'class': 'source-meta', text: 'Because: ' + correction.reason }),
          ]),
        ]);
      }),

      challenges.length > 0
        ? h('div', { 'class': 'stack stack--sm' }, [
          eyebrow('Challenges raised'),
          h('ul', { 'class': 'bullets small' }, challenges.map(function (event) {
            return h('li', { text: event.message });
          })),
        ])
        : null,
    ]);
  }

  function verificationPanel(runs) {
    var records = state.pkg.verifications || [];
    if (records.length === 0) {
      return h('section', { 'class': 'card stack' }, [
        heading('Verification'),
        small('The Risk & Verification agent has not reported on this mission yet.', true),
      ]);
    }

    var output = runs.risk_verification && runs.risk_verification.output;
    var passed = output && typeof output.verification_passed === 'boolean' ? output.verification_passed : null;

    return h('section', { 'class': 'stack' }, [
      h('div', { 'class': 'row row--between row--wrap' }, [
        heading('Verification'),
        pill(passed === null ? 'In progress' : passed ? 'Gate passed' : 'Gate failed',
          passed ? 'pill--positive' : 'pill--negative'),
      ]),
      small('The gate checks the island against itself — contradictions, unsupported numbers, claims that cannot stand. It is not a check against the world, because this island cannot reach one.', true),
      h('div', { 'class': 'card card--flush table-wrap' }, h('table', { 'class': 'table' }, [
        h('thead', null, h('tr', null, ['Finding', 'Agent', 'Result', 'Why', 'What must happen', 'Round'].map(function (label) {
          return h('th', { text: label });
        }))),
        h('tbody', null, records.map(function (record) {
          // "Verified" is not a result this island can return, so a row claiming
          // it is shown for what it is: a claim nobody checked.
          var status = record.status === 'verified' ? 'needs_verification' : record.status;
          var tone = status === 'high_risk' ? 'pill--negative' : 'pill--warning';
          return h('tr', null, [
            h('td', { 'class': 'mono small', text: record.findingId }),
            h('td', { 'class': 'small', text: agentName(record.agentId) }),
            h('td', null, pill(humanise(status), tone)),
            h('td', { 'class': 'small', text: record.reason }),
            h('td', { 'class': 'small', text: record.resolved ? record.correctedValue || 'Resolved' : record.recommendedAction }),
            h('td', { 'class': 'small tabular', text: record.round }),
          ]);
        })),
      ])),
    ]);
  }

  function sourcePanel() {
    var sources = state.pkg.sources || [];
    return h('section', { 'class': 'card stack' }, [
      h('div', { 'class': 'row row--between row--wrap' }, [
        heading('Source register'),
        h('span', { 'class': 'source-meta', text: plural(sources.length, 'source') }),
      ]),
      sources.length === 0
        ? small('Empty, and it will stay empty: this island has no way to read a source. Every claim in this mission was made without one, and every label above says so.', true)
        : h('div', { 'class': 'stack stack--sm' }, [
          small('Recalled, not read. Nothing here was opened, so each entry is a reference the model believes exists.', true),
          sources.map(function (source) {
            return h('div', { 'class': 'source-item' }, [
              h('span', { 'class': 'source-ref', text: source.source_id }),
              h('div', { 'class': 'grow' }, [
                h('span', { text: source.title || source.url || 'Untitled' }),
                source.url ? h('div', { 'class': 'mono source-meta', text: source.url }) : null,
                h('div', {
                  'class': 'source-meta',
                  text: source.source_type + ' · ' + source.reliability + ' reliability as claimed · not opened',
                }),
              ]),
            ]);
          }),
        ]),
    ]);
  }

  /* --- the report ---------------------------------------------------------- */

  function reportSection(title, children) {
    return h('section', { 'class': 'card report__section' }, [heading(title), children]);
  }

  function reportView(mission, report) {
    var currency = (report.financial_summary && report.financial_summary.currency) || mission.currency || 'USD';
    var decision = report.recommendation ? report.recommendation.decision : 'more_research';
    var usedForex = (mission.enabledAgents || []).some(function (id) {
      return FOREX_AGENTS.indexOf(id) !== -1;
    });
    var financial = report.financial_summary || {};
    var audit = report.verification || {};

    // Nothing was retrieved, so nothing was verified. The count is printed as
    // the zero it has to be, and whatever the gate called verified is moved into
    // the column that says a person still has to check it.
    var claimedVerified = audit.verified || 0;
    var needsCheck = (audit.needs_verification || 0) + claimedVerified;

    return h('div', { 'class': 'report' }, [
      disclosureBanner(usedForex),

      h('div', { 'class': 'verdict verdict--' + (DECISION_TONE[decision] || 'research') }, [
        h('div', { 'class': 'grow stack stack--sm' }, [
          h('span', { 'class': 'verdict__text', text: DECISION_LABEL[decision] || humanise(decision) }),
          h('p', { 'class': 'prose', text: report.recommendation ? report.recommendation.reason : '' }),
        ]),
        confidenceMeter(
          report.overall_confidence,
          'Overall confidence',
          (report.confidence_explanation ? report.confidence_explanation + ' ' : '') + CEILING_NOTE,
        ),
      ]),

      reportSection('1. Executive summary', h('p', { 'class': 'prose', text: report.executive_summary })),

      reportSection('2. Key findings', (report.key_findings || []).length === 0
        ? small('No finding survived review.', true)
        : report.key_findings.map(function (finding, index) {
          return h('div', { 'class': 'source-item' }, [
            h('span', { 'class': 'source-ref', text: index + 1 }),
            h('div', { 'class': 'grow stack stack--sm' }, [
              h('div', { 'class': 'row row--between row--wrap' }, [
                labelChip(finding.label),
                h('span', {
                  'class': 'source-meta',
                  text: (finding.evidence || []).length > 0
                    ? 'Evidence cited: ' + finding.evidence.join(', ') + ' — recalled, not read'
                    : 'No evidence cited',
                }),
              ]),
              small(finding.finding),
              confidenceMeter(finding.confidence, null),
            ]),
          ]);
        })),

      reportSection('3. Research', h('p', { 'class': 'prose', text: report.research_summary })),
      reportSection('4. Competitors', h('p', { 'class': 'prose', text: report.competitor_summary })),
      reportSection('5. Market', h('p', { 'class': 'prose', text: report.market_summary })),
      reportSection('6. Analysis', h('p', { 'class': 'prose', text: report.analysis_summary })),

      reportSection('7. Financials', [
        h('div', { 'class': 'grid grid--3' }, [
          stat('Start-up cost', formatMoney(financial.estimated_startup_cost, currency), 'guess, not a quote'),
          stat('Monthly cost', formatMoney(financial.estimated_monthly_cost, currency), 'guess, not a quote'),
          stat('Monthly revenue', formatMoney(financial.estimated_monthly_revenue, currency), 'guess, not a quote'),
        ]),
        small(financial.note || '', true),
        small('No price, rate or wage here was looked up. Every figure is the model\'s recollection of a range, so check all three before they reach a spreadsheet.', true),
      ]),

      reportSection('8. Major risks', bullets(report.major_risks, 'No major risk was recorded.')),

      reportSection('9. Verification', [
        h('div', { 'class': 'grid grid--4' }, [
          stat('Claims reviewed', String(audit.total_claims_reviewed || 0)),
          stat('Verified', '0', 'nothing here can be verified'),
          stat('Need verification', String(needsCheck), claimedVerified > 0 ? claimedVerified + ' moved here' : null),
          stat('High risk', String(audit.high_risk_items || 0),
            plural(audit.contradictions || 0, 'contradiction'),
            audit.high_risk_items > 0 ? 'negative' : null),
        ]),
        small((audit.passed ? 'The verification gate passed' : 'The verification gate did not pass') +
          ' after ' + plural(audit.rounds_used || 0, 'correction round') +
          '. It compared the island\'s claims against each other, which is the only check available here.'),
      ]),

      reportSection('10. Strategy', h('p', { 'class': 'prose', text: report.strategy_summary })),

      reportSection('11. Recommendation', [
        h('div', { 'class': 'row row--wrap' },
          pill(DECISION_LABEL[decision] || humanise(decision), DECISION_PILL[decision] || 'pill--muted')),
        h('p', { 'class': 'prose', text: report.recommendation ? report.recommendation.reason : '' }),
      ]),

      reportSection('12. Action plan', (report.action_plan || []).length === 0
        ? small('No action plan was produced.', true)
        : h('ol', { 'class': 'bullets small' }, report.action_plan.slice().sort(function (a, b) {
          return a.priority - b.priority;
        }).map(function (item) {
          return h('li', null, [
            h('strong', { text: item.action }),
            h('div', { 'class': 'source-meta', text: item.reason }),
          ]);
        }))),

      reportSection('13. Assumptions', bullets(report.assumptions, 'No assumption was recorded, which is itself worth questioning.')),

      reportSection('14. Still unknown', [
        bullets(report.unresolved_questions, 'Nothing was left open.'),
        (report.unresolved_issues || []).length > 0
          ? h('div', { 'class': 'stack stack--sm' }, [
            eyebrow('Unresolved issues'),
            h('ul', { 'class': 'bullets small' }, report.unresolved_issues.map(function (issue) {
              return h('li', null, [
                pill(issue.severity, issue.severity === 'high' ? 'pill--negative' : 'pill--warning'),
                ' ' + agentName(issue.agent) + ' · ',
                h('span', { 'class': 'mono', text: issue.finding_id }),
                ': ' + issue.problem,
                h('div', { 'class': 'source-meta', text: 'Required: ' + issue.required_action }),
              ]);
            })),
          ])
          : null,
      ]),

      reportSection('15. Corrections made', (report.corrections || []).length === 0
        ? small('No claim had to be corrected.', true)
        : report.corrections.map(function (correction) {
          return h('div', { 'class': 'source-item' }, [
            h('span', { 'class': 'source-ref', text: correction.findingId }),
            h('div', { 'class': 'grow' }, [
              h('div', {
                'class': 'small strong',
                text: agentName(correction.fromAgent) + ' → ' + agentName(correction.toAgent),
              }),
              h('div', { 'class': 'source-meta', text: 'Was: ' + correction.originalClaim }),
              h('div', { 'class': 'small', text: 'Now: ' + correction.correctedClaim }),
            ]),
          ]);
        })),

      reportSection('16. Sources', (report.sources || []).length === 0
        ? small('No source was consulted, because none could be. Weigh every claim above accordingly.', true)
        : report.sources.map(function (source) {
          return h('div', { 'class': 'source-item' }, [
            h('span', { 'class': 'source-ref', text: source.source_id }),
            h('div', { 'class': 'grow' }, [
              h('span', { text: source.title || source.url || 'Untitled' }),
              source.url ? h('div', { 'class': 'mono source-meta', text: source.url }) : null,
              h('div', {
                'class': 'source-meta',
                text: source.source_type + ' · ' + source.reliability + ' reliability as claimed · not opened',
              }),
            ]),
          ]);
        })),

      reportSection('17. Who did what', [
        // The table's cells are inset by their own padding, so bare in a padded
        // card the whole table hangs to the right of its title with nothing to
        // justify it. Its own flush card gives it a left edge on the heading's line.
        h('div', { 'class': 'card card--flush table-wrap' }, h('table', { 'class': 'table' }, [
          h('thead', null, h('tr', null, ['Agent', 'Status', 'Contribution'].map(function (label) {
            return h('th', { text: label });
          }))),
          h('tbody', null, (report.agent_summary || []).map(function (entry) {
            return h('tr', null, [
              h('td', { 'class': 'small', text: entry.name || agentName(entry.agent) }),
              h('td', { 'class': 'small', text: AGENT_STATE_LABEL[entry.status] || humanise(entry.status) }),
              h('td', { 'class': 'small', text: entry.key_contribution }),
            ]);
          })),
        ])),
        h('span', {
          'class': 'source-meta',
          text: (report.mission_reference || mission.reference || mission.id) +
            ' · generated ' + formatDateTime(report.generated_at) + ' · no retrieval, no sources',
        }),
      ]),
    ]);
  }

  /* --- history ------------------------------------------------------------- */

  var HISTORY_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'running', label: 'Running' },
    { value: 'awaiting_approval', label: 'Waiting for you' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'aborted', label: 'Stopped' },
  ];

  function loadHistory() {
    var listFn = engineFn(['listMissions', 'missions', 'allMissions']);
    if (!listFn) {
      state.missions = [];
      scheduleRender();
      return;
    }
    Promise.resolve(listFn()).then(function (result) {
      state.missions = Array.isArray(result) ? result : (result && result.missions) || [];
      state.historyError = null;
      scheduleRender();
    }).catch(function (caught) {
      state.missions = [];
      state.historyError = describeError(caught);
      scheduleRender();
    });
  }

  function renderHistory() {
    var missions = state.missions;
    var filtered = (missions || []).filter(function (mission) {
      return state.historyFilter === 'all' || mission.status === state.historyFilter;
    });

    fill(byId('screen-history'), [
      h('div', { 'class': 'row row--between row--wrap row--top' }, [
        h('div', { 'class': 'page-head' }, [
          h('h1', { 'class': 'page-head__title', text: 'Missions' }),
          h('p', {
            'class': 'page-head__sub',
            text: state.caps.db === false
              ? 'Every mission run in this browser tab. No storage is available to this page, so the list empties on reload.'
              : 'Every mission this island has been sent.',
          }),
        ]),
        h('button', {
          type: 'button',
          'class': 'btn btn--sm',
          text: 'New mission',
          onclick: function () {
            show('control');
          },
        }),
      ]),

      h('div', { 'class': 'tabs', role: 'tablist', 'aria-label': 'Filter missions by status' },
        HISTORY_FILTERS.map(function (filter) {
          return h('button', {
            type: 'button',
            role: 'tab',
            'class': 'tab',
            'aria-selected': state.historyFilter === filter.value ? 'true' : 'false',
            text: filter.label,
            onclick: function () {
              state.historyFilter = filter.value;
              scheduleRender();
            },
          });
        })),

      state.historyError ? errorNote(state.historyError, loadHistory) : null,

      missions === null
        ? h('div', { 'class': 'stack', 'aria-busy': 'true' }, [
          h('div', { 'class': 'skeleton', style: 'height: 88px' }),
          h('div', { 'class': 'skeleton', style: 'height: 64px' }),
        ])
        : filtered.length === 0
          ? empty('No missions yet', 'Give the island a question and it starts work immediately.',
            h('button', {
              type: 'button',
              'class': 'btn btn--sm',
              text: 'Start a mission',
              onclick: function () {
                show('control');
              },
            }))
          : h('div', { 'class': 'card card--flush' },
            h('div', { 'class': 'mission-list' }, filtered.map(missionRow))),
    ]);
  }

  function missionRow(mission) {
    return h('a', {
      'class': 'mission-item',
      href: '#',
      onclick: function (event) {
        event.preventDefault();
        openStoredMission(mission);
      },
    }, [
      h('div', { 'class': 'grow' }, [
        h('div', { 'class': 'mission-item__ref', text: mission.reference || mission.id }),
        h('div', { 'class': 'mission-item__task truncate', text: mission.userTask }),
        h('div', {
          'class': 'mission-item__meta',
          text: formatDateTime(mission.startedAt || mission.createdAt) + ' · ' +
            (mission.mode === 'approval' ? 'approval gates' : 'automatic') + ' · nothing retrieved',
        }),
      ]),
      h('div', { 'class': 'row row--wrap' }, [
        mission.decision ? pill(DECISION_LABEL[mission.decision] || humanise(mission.decision), 'pill--muted') : null,
        typeof mission.confidence === 'number'
          ? h('span', {
            'class': 'pill pill--muted tabular',
            title: 'Overall confidence',
            text: formatPercent(honestConfidence(mission.confidence)),
          })
          : null,
        statusPill(mission.status),
      ]),
    ]);
  }

  function openStoredMission(mission) {
    var getFn = engineFn(['getMission', 'loadMission', 'fetchMission', 'mission']);
    if (!getFn) {
      openMission(asPackage(mission));
      return;
    }
    Promise.resolve(getFn(mission.id)).then(function (result) {
      openMission(asPackage(result) || asPackage(mission));
    }).catch(function (caught) {
      openMission(asPackage(mission));
      state.missionError = describeError(caught);
      scheduleRender();
    });
  }

  /* --- live wiring --------------------------------------------------------- */

  function scheduleRefresh() {
    // A burst of events at the end of a wave should cost one reload, not six.
    var getFn = engineFn(['getMission', 'loadMission', 'fetchMission', 'mission']);
    if (!getFn || refreshTimer || !state.pkg) return;
    var missionId = state.pkg.mission.id;
    refreshTimer = window.setTimeout(function () {
      refreshTimer = null;
      Promise.resolve(getFn(missionId)).then(function (result) {
        var pkg = asPackage(result);
        // The viewer may have moved to another mission while this was in flight.
        if (!pkg || !state.pkg || state.pkg.mission.id !== missionId) return;
        state.pkg = pkg;
        state.events = mergeEvents(state.events, pkg.events);
        scheduleRender();
      }).catch(function (caught) {
        state.missionError = describeError(caught);
        scheduleRender();
      });
    }, 600);
  }

  function handleEngineEvent(incoming) {
    if (!incoming) return;
    // The engine may deliver a bare event or an event wrapped with the package
    // it belongs to; both carry the same event underneath.
    var event = incoming.event || incoming;
    // Only a wrapper carrying the mission's runs is taken as a whole package.
    // Anything thinner would replace the view's runs and corrections with empty
    // arrays and blank a mission that is part way through.
    var wrapper = incoming.package || (incoming.event ? incoming : null);
    var pkg = wrapper && wrapper.runs ? asPackage(wrapper) : null;
    var missionId = event.missionId || event.mission_id;

    if (state.pkg && missionId === state.pkg.mission.id) {
      state.events = mergeEvents(state.events, [event]);
      if (pkg && pkg.mission && pkg.mission.id === missionId) state.pkg = pkg;
      else if (RELOAD_ON[event.type]) scheduleRefresh();
      scheduleRender();
      return;
    }
    // An event from a mission we are not looking at still ages the history list.
    if (RELOAD_ON[event.type] && state.view === 'history') loadHistory();
  }

  /* --- render -------------------------------------------------------------- */

  function render() {
    // Only the screen on show is rebuilt. Repainting the idle map behind a
    // running mission would cost seventeen stations a frame for a picture
    // nobody is looking at.
    if (state.view === 'control') syncControl();
    if (state.view === 'mission') renderMission();
    if (state.view === 'history') renderHistory();
    renderEngineBadge();
  }

  function renderEngineBadge() {
    var slot = byId('app-engine');
    if (!slot) return;
    var text = !engine
      ? 'Engine unavailable'
      : state.caps.sample === false
        ? 'Claude unavailable'
        : state.caps.db === false
          ? 'No storage · this session only'
          : 'No retrieval · reasoning only';
    if (slot.getAttribute('data-text') === text) return;
    slot.setAttribute('data-text', text);
    fill(slot, h('span', { 'class': 'truncate', text: text }));
  }

  /* --- start --------------------------------------------------------------- */

  function wireNav() {
    var links = document.querySelectorAll('[data-view]');
    for (var i = 0; i < links.length; i += 1) {
      links[i].addEventListener('click', function (event) {
        event.preventDefault();
        var view = event.currentTarget.getAttribute('data-view');
        if (view === 'history') loadHistory();
        show(view);
      });
    }
  }

  function start() {
    ROSTER.forEach(function (agent) {
      if (!agent.core) state.picked[agent.id] = agent.enabledByDefault === true;
    });

    wireNav();
    buildControl();
    syncControl();

    if (!engine) {
      renderEngineBadge();
      return;
    }

    var subscribe = engineFn(['onEvent', 'subscribe', 'listen']);
    if (subscribe) subscribe(handleEngineEvent);

    var init = engineFn(['init', 'ready', 'boot', 'connect']);
    // Absence is only reported when the engine says so: an engine that does not
    // answer this question is assumed able until a call proves otherwise, which
    // is better than greying out a page that works.
    Promise.resolve(init ? init() : engine.capabilities).then(function (caps) {
      if (caps && typeof caps === 'object') {
        state.caps.sample = caps.sample !== false && caps.sample !== null;
        state.caps.db = caps.db !== false && caps.db !== null;
      }
      syncControl();
      renderEngineBadge();
      loadHistory();
    }).catch(function (caught) {
      state.controlError = describeError(caught);
      syncControl();
    });
  }

  return { start: start };
})();
