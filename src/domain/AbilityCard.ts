const roman: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V' };
export function abilityLabel(name: string): string {
  return name
    .replace(/^GanderAbilityCard_/, '')
    .replace(/_Lv(\d+)$/i, (_, n: string) => ` ${roman[n] ?? n}`)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ');
}
