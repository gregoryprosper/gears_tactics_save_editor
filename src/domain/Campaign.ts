export interface CampaignState {
  mission?: string;
  completion?: number;
  difficulty?: string;
  gameType?: string;
  gameState?: string;
  rosterCapacity?: number;
  rosterObjectIndex?: number;
  characterCount: number;
}
