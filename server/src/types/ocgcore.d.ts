// Our engine build ships JavaScript only; this keeps TypeScript happy until we generate full types.
declare module 'ocgcore-wasm' {
  const createCore: (options?: any) => Promise<any>;
  export default createCore;
  export const OcgDuelMode: any, OcgHintType: any, OcgLocation: any, OcgMessageType: any, OcgPhase: any, OcgPosition: any, OcgProcessResult: any,
    OcgQueryFlags: any, OcgResponseType: any, OcgType: any, SelectBattleCMDAction: any, SelectIdleCMDAction: any;
  export const ocgAttributeString: Map<any, string>, ocgRaceString: Map<any, string>;
  export function cardMatchesOpcode(card: any, opcodes: any[]): boolean;
}
