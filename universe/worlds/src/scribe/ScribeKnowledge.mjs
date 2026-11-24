import { ScribeAnswer } from './ScribeAnswer.mjs';
import { ScribeLogCore } from './ScribeLogCore.mjs';
import { ScribeReplay } from './ScribeReplay.mjs';

export const ScribeKnowledge = Object.freeze({
  Cover: Object.freeze({
    None: 'None',
    Open: 'Open',
    Closed: 'Closed',
  }),

  Layer: Object.freeze({
    Scene: 'Scene',
    Closed: 'Closed',
    Absent: 'Absent',
  }),

  Settings: Object.freeze({
    Opening: 1,
    Closing: -1,
  }),

  /**
   * @returns {string}
   */
  get Everyone() {
    return ScribeLogCore.Settings.Everyone;
  },

  /**
   * @param {{reach: string, narrowed: boolean}} scene
   * @returns {boolean}
   */
  open(scene) {
    return scene.reach === ScribeAnswer.Reach.Public && !scene.narrowed;
  },

  /**
   * @param {{from: number | null, until: number | null}} entry
   * @param {number} position
   * @returns {boolean}
   */
  within(entry, position) {
    return (entry.from === null || entry.from <= position) && (entry.until === null || entry.until >= position);
  },

  /**
   * @param {readonly object[]} scenes
   * @returns {object | null}
   */
  narrowest(scenes) {
    let found = null;
    for (const scene of scenes) {
      const span = scene.lastPosition - scene.firstPosition;
      const shorter = found === null || span < found.lastPosition - found.firstPosition;
      const tied = found !== null && span === found.lastPosition - found.firstPosition;
      if (shorter || (tied && scene.firstPosition > found.firstPosition)) {
        found = scene;
      }
    }
    return found;
  },

  /**
   * @param {object} state
   * @param {number} position
   * @returns {{closed: object[], open: object[]}}
   */
  covering(state, position) {
    const closed = [];
    const open = [];
    for (const scene of state.scenes) {
      if (scene.firstPosition > position || position > scene.lastPosition) {
        continue;
      }
      if (ScribeKnowledge.open(scene)) {
        open.push(scene);
      } else {
        closed.push(scene);
      }
    }
    return { closed, open };
  },

  /**
   * @param {object} state
   * @param {string} id
   * @returns {string}
   */
  survivor(state, id) {
    const subject = state.subjects.find((candidate) => candidate.id === id);
    return subject === undefined || subject.mergedInto === null ? id : subject.mergedInto;
  },

  /**
   * @param {object} fact
   * @param {string} cover
   * @param {readonly string[]} there
   * @returns {string | readonly string[]}
   */
  listeners(fact, cover, there) {
    const everyone = ScribeKnowledge.Everyone;
    const origins = ScribeLogCore.Origin;
    if (fact.widened === everyone) {
      return everyone;
    }
    const noted = fact.origin === origins.Notes || fact.origin === origins.Operator;
    if (!fact.hidden && (noted || cover === ScribeKnowledge.Cover.Open)) {
      return everyone;
    }
    const named = new Set([fact.subject]);
    if (!fact.hidden && cover === ScribeKnowledge.Cover.Closed) {
      for (const id of there) {
        named.add(id);
      }
    }
    for (const id of fact.told) {
      named.add(id);
    }
    if (fact.widened !== null) {
      for (const id of fact.widened) {
        named.add(id);
      }
    }
    return Object.freeze([...named]);
  },

  /**
   * @param {string | readonly string[]} audience
   * @param {string} knower
   * @returns {boolean}
   */
  heard(audience, knower) {
    return audience === ScribeKnowledge.Everyone || audience.includes(knower);
  },

  /**
   * @param {object} state
   * @param {number} position
   * @returns {object | null}
   */
  sceneAt(state, position) {
    const { closed, open } = ScribeKnowledge.covering(state, position);
    return ScribeKnowledge.narrowest(closed.length > 0 ? closed : open);
  },

  /**
   * @param {object} state
   * @param {object} fact
   * @returns {string | readonly string[]}
   */
  audience(state, fact) {
    const cover = ScribeKnowledge.Cover;
    const { closed, open } = ScribeKnowledge.covering(state, fact.position);
    if (closed.length === 0) {
      return ScribeKnowledge.listeners(fact, open.length > 0 ? cover.Open : cover.None, []);
    }
    const there = [];
    for (const attendee of ScribeKnowledge.narrowest(closed).present) {
      const everywhere = closed.every((scene) => {
        return scene.present.some((entry) => {
          return entry.subject === attendee.subject && ScribeKnowledge.within(entry, fact.position);
        });
      });
      if (ScribeKnowledge.within(attendee, fact.position) && everywhere) {
        there.push(attendee.subject);
      }
    }
    return ScribeKnowledge.listeners(fact, cover.Closed, there);
  },

  /**
   * @param {object} state
   * @param {string} knower
   * @param {object} fact
   * @returns {boolean}
   */
  knows(state, knower, fact) {
    return ScribeKnowledge.heard(ScribeKnowledge.audience(state, fact), ScribeKnowledge.survivor(state, knower));
  },

  /**
   * @param {object} state
   * @param {string} knower
   * @param {string} subject
   * @returns {Readonly<{facts: readonly object[], scenes: readonly object[]}>}
   */
  about(state, knower, subject) {
    const layers = ScribeKnowledge.Layer;
    const cover = ScribeKnowledge.Cover;
    const settings = ScribeKnowledge.Settings;
    const reader = ScribeKnowledge.survivor(state, knower);
    const owner = ScribeKnowledge.survivor(state, subject);
    const byId = new Map();
    for (const fact of state.facts) {
      byId.set(fact.id, fact);
    }
    const thinner = new Map();
    for (const refinement of state.refinements) {
      thinner.set(refinement.to, byId.get(refinement.from));
    }
    const chains = [];
    const positions = new Set();
    for (const fact of state.facts) {
      if (fact.subject !== owner || fact.status !== ScribeReplay.Status.InForce) {
        continue;
      }
      const chain = [];
      for (let wording = fact; wording !== undefined; wording = thinner.get(wording.id)) {
        chain.push(wording);
        positions.add(wording.position);
      }
      chains.push(chain);
    }
    const stretches = [];
    const attended = [];
    for (const scene of state.scenes) {
      const spans = [];
      let listed = false;
      for (const attendee of scene.present) {
        const start = Math.max(attendee.from ?? scene.firstPosition, scene.firstPosition);
        const end = Math.min(attendee.until ?? scene.lastPosition, scene.lastPosition);
        listed = listed || attendee.subject === owner;
        if (attendee.subject === reader && start <= end) {
          spans.push({ start, end });
        }
      }
      spans.sort((first, second) => first.start - second.start);
      const missing = [];
      let reached = scene.firstPosition;
      for (const span of spans) {
        if (span.start > reached) {
          missing.push({ start: reached, end: span.start - 1 });
        }
        reached = Math.max(reached, span.end + 1);
      }
      if (reached <= scene.lastPosition) {
        missing.push({ start: reached, end: scene.lastPosition });
      }
      const open = ScribeKnowledge.open(scene);
      stretches.push({ start: scene.firstPosition, end: scene.lastPosition, layer: layers.Scene });
      if (!open) {
        stretches.push({ start: scene.firstPosition, end: scene.lastPosition, layer: layers.Closed });
        for (const gap of missing) {
          stretches.push({ start: gap.start, end: gap.end, layer: layers.Absent });
        }
      }
      if (listed && (open || missing.length === 0)) {
        attended.push(scene);
      }
    }
    const events = [];
    for (const stretch of stretches) {
      events.push(
        { at: stretch.start, layer: stretch.layer, step: settings.Opening },
        { at: stretch.end + 1, layer: stretch.layer, step: settings.Closing },
      );
    }
    events.sort((first, second) => first.at - second.at);
    const sorted = [...positions].sort((first, second) => first - second);
    const depth = { [layers.Scene]: 0, [layers.Closed]: 0, [layers.Absent]: 0 };
    const places = new Map();
    let pointer = 0;
    for (const position of sorted) {
      while (pointer < events.length && events[pointer].at <= position) {
        depth[events[pointer].layer] += events[pointer].step;
        pointer += 1;
      }
      let covered = cover.None;
      if (depth[layers.Closed] > 0) {
        covered = cover.Closed;
      } else if (depth[layers.Scene] > 0) {
        covered = cover.Open;
      }
      places.set(position, { cover: covered, there: depth[layers.Absent] === 0 ? [reader] : [] });
    }
    const facts = [];
    for (const chain of chains) {
      const known = chain.find((wording) => {
        const place = places.get(wording.position);
        return ScribeKnowledge.heard(ScribeKnowledge.listeners(wording, place.cover, place.there), reader);
      });
      if (known !== undefined) {
        facts.push(known);
      }
    }
    return Object.freeze({ facts: Object.freeze(facts), scenes: Object.freeze(attended) });
  },
});
