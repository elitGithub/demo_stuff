const STYLE_VALUES = Object.freeze({
  Explicit: 'explicit',
  Combat: 'combat',
  Tension: 'tension',
  Emotional: 'emotional',
  Banter: 'banter',
  Travel: 'travel',
  Investigation: 'investigation',
  None: 'none',
});

const EDITABLE_VALUES = Object.freeze([
  STYLE_VALUES.Explicit,
  STYLE_VALUES.Combat,
  STYLE_VALUES.Tension,
  STYLE_VALUES.Emotional,
  STYLE_VALUES.Banter,
  STYLE_VALUES.Travel,
  STYLE_VALUES.Investigation,
]);

const ALL_VALUES = Object.freeze([
  ...EDITABLE_VALUES,
  STYLE_VALUES.None,
]);

const DEFAULT_TEXTS = Object.freeze({
  [STYLE_VALUES.Explicit]:
    'Match the tone and pace of the scene. Describe sexual activity in vivid, explicit detail: bodies, touch, taste, sound, breath, reactions. Build a hot scene loaded with sexual tension; let each beat escalate or linger instead of rushing to the end. Desire, hesitation and dominance follow who the character is.',
  [STYLE_VALUES.Combat]:
    "Write a fluent, exciting fight, blow by blow: footing, distance, weapons, injuries, shifts in momentum. Build every move on what you know about the character: skills, gear, wounds, build. Follow what the player declared, and never decide the outcome of the player's own action. Use short, punchy sentences at the peaks.",
  [STYLE_VALUES.Tension]:
    'Focus on a tense atmosphere: what is left unsaid, small sounds, glances, held breath, the sense that something is about to break. Slow the pace and hold back resolution. Characters guard their words and watch each other.',
  [STYLE_VALUES.Emotional]:
    'Focus on feelings and the space between people: vulnerability, warmth, regret, comfort. Show emotion through small gestures, silences and tone of voice rather than naming it. Let moments breathe; no jokes that break the mood unless that is who the character is.',
  [STYLE_VALUES.Banter]:
    'Light, quick, playful exchanges. Wit, teasing and personality over plot. Keep replies short and reactive, let characters bounce off each other, and keep descriptions brief.',
  [STYLE_VALUES.Travel]:
    "Bring the place to life: landscape, weather, smells, sounds, distance, and the people and creatures met on the way. Leave things for the player to notice and choose from. Keep the group's mood and fatigue present.",
  [STYLE_VALUES.Investigation]:
    'Focus on detail and clues: what can be seen, read, overheard or worked out. Characters reason aloud only from what they actually know and never reveal more than the scene supports. Leave the conclusions for the player to draw.',
});

export const SceneStyle = Object.freeze({
  Explicit: STYLE_VALUES.Explicit,
  Combat: STYLE_VALUES.Combat,
  Tension: STYLE_VALUES.Tension,
  Emotional: STYLE_VALUES.Emotional,
  Banter: STYLE_VALUES.Banter,
  Travel: STYLE_VALUES.Travel,
  Investigation: STYLE_VALUES.Investigation,
  None: STYLE_VALUES.None,
  EditableValues: EDITABLE_VALUES,
  AllValues: ALL_VALUES,
  Defaults: DEFAULT_TEXTS,

  /**
   * @param {string} value
   * @returns {string}
   * @throws {RangeError}
   */
  label(value) {
    switch (value) {
      case STYLE_VALUES.Explicit: {
        return 'Explicit';
      }
      case STYLE_VALUES.Combat: {
        return 'Combat';
      }
      case STYLE_VALUES.Tension: {
        return 'Tension';
      }
      case STYLE_VALUES.Emotional: {
        return 'Emotional';
      }
      case STYLE_VALUES.Banter: {
        return 'Banter';
      }
      case STYLE_VALUES.Travel: {
        return 'Travel';
      }
      case STYLE_VALUES.Investigation: {
        return 'Investigation';
      }
      case STYLE_VALUES.None: {
        return 'None';
      }
      default: {
        throw new RangeError(`Unknown SceneStyle: ${String(value)}`);
      }
    }
  },
});
