import { WIZARD_BY_ID } from '../shared/wizards.js';

/** Display name for a bot, derived from the wizard it currently plays. */
export function botName(wizardId) {
  const first = WIZARD_BY_ID[wizardId]?.name.split(' ')[0] ?? 'Shade';
  return `${first} (bot)`;
}
