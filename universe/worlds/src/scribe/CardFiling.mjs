import { CharacterCard } from '../store/CharacterCard.mjs';
import { ScribeCategory } from './ScribeCategory.mjs';
import { ScribeKnowledge } from './ScribeKnowledge.mjs';
import { ScribeLogCore } from './ScribeLogCore.mjs';
import { ScribeReplay } from './ScribeReplay.mjs';

export class CardFiling {
  static Separator = '; ';
  static CardPosition = 0;

  static Slots = Object.freeze([
    Object.freeze({
      key: CharacterCard.Field.Age,
      category: ScribeCategory.Names.Age,
      kind: ScribeCategory.Kind.Fixed,
      fields: Object.freeze([CharacterCard.Field.Age]),
    }),
    Object.freeze({
      key: CharacterCard.Field.Hair,
      category: ScribeCategory.Names.Hair,
      kind: ScribeCategory.Kind.Fixed,
      fields: Object.freeze([CharacterCard.Field.Hair]),
    }),
    Object.freeze({
      key: CharacterCard.Field.Eyes,
      category: ScribeCategory.Names.Eyes,
      kind: ScribeCategory.Kind.Fixed,
      fields: Object.freeze([CharacterCard.Field.Eyes]),
    }),
    Object.freeze({
      key: ScribeCategory.Names.Build,
      category: ScribeCategory.Names.Build,
      kind: ScribeCategory.Kind.Fixed,
      fields: Object.freeze([CharacterCard.Field.Height, CharacterCard.Field.Body]),
    }),
    Object.freeze({
      key: CharacterCard.Field.Face,
      category: ScribeCategory.Names.Appearance,
      kind: ScribeCategory.Kind.List,
      fields: Object.freeze([CharacterCard.Field.Face]),
    }),
    Object.freeze({
      key: CharacterCard.Field.Features,
      category: ScribeCategory.Names.Feature,
      kind: ScribeCategory.Kind.List,
      fields: Object.freeze([CharacterCard.Field.Features]),
    }),
  ]);

  static ListFields = Object.freeze(
    CardFiling.Slots.filter((slot) => slot.kind === ScribeCategory.Kind.List).map((slot) => slot.key),
  );

  /**
   * @param {CharacterCard} before
   * @param {CharacterCard} after
   * @returns {readonly string[]}
   */
  static changedFields(before, after) {
    return Object.freeze(
      CharacterCard.AppearanceFields.filter((field) => before[field].trim() !== after[field].trim()),
    );
  }

  /**
   * @param {{state: object, subjectId: string, before: CharacterCard, after: CharacterCard}} options
   * @returns {readonly Readonly<{field: string, operation: Readonly<object>}>[]}
   */
  static operations({ state, subjectId, before, after }) {
    const changed = CardFiling.changedFields(before, after);
    const owner = ScribeKnowledge.survivor(state, subjectId);
    const steps = [];
    for (const slot of CardFiling.Slots) {
      if (!slot.fields.some((field) => changed.includes(field))) {
        continue;
      }
      const text = slot.fields
        .map((field) => after[field].trim())
        .filter((part) => part.length > 0)
        .join(CardFiling.Separator);
      const replaced = new Set();
      if (slot.kind === ScribeCategory.Kind.List) {
        const chain = [];
        let link = state.facts.find((fact) => fact.id === before.filedFactIds[slot.key]);
        while (link !== undefined) {
          chain.push(link);
          const successor = link.replacedBy;
          link = state.facts.find((fact) => fact.id === successor);
        }
        const removable =
          chain.length > 0 &&
          ScribeReplay.live(chain.at(-1)) &&
          chain.every((fact) => fact.subject === owner && fact.category === slot.category);
        if (removable) {
          for (const fact of chain) {
            replaced.add(fact.id);
            if (fact.status !== ScribeReplay.Status.Removed) {
              steps.push(
                Object.freeze({
                  field: slot.key,
                  operation: Object.freeze({
                    type: ScribeLogCore.Ruling.RemoveFact,
                    fact: fact.id,
                    exact: true,
                  }),
                }),
              );
            }
          }
        }
        const duplicated = state.facts.some((fact) => {
          return (
            fact.subject === owner &&
            fact.category === slot.category &&
            ScribeReplay.live(fact) &&
            !replaced.has(fact.id) &&
            ScribeCategory.value(fact) === ScribeCategory.value({ text })
          );
        });
        if (duplicated) {
          continue;
        }
      }
      if (text.length === 0) {
        continue;
      }
      steps.push(
        Object.freeze({
          field: slot.key,
          operation: Object.freeze({
            type: ScribeLogCore.Ruling.AddFact,
            subject: subjectId,
            category: slot.category,
            target: null,
            text,
            hidden: false,
            cite: null,
            position: CardFiling.CardPosition,
            ...(slot.kind === ScribeCategory.Kind.Fixed ? { decided: true } : {}),
          }),
        }),
      );
    }
    return Object.freeze(steps);
  }
}
