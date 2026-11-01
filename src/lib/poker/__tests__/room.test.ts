import { describe, expect, it } from 'vitest';
import { seededRng } from '../cards.ts';
import { getLegalActions, totalChips } from '../game.ts';
import type { Room } from '../room.ts';
import {
  addBot,
  backToLobby,
  createRoom,
  generateRoomCode,
  joinRoom,
  kickPlayer,
  leaveRoom,
  playerAction,
  privateHands,
  publicRoom,
  RoomError,
  startRoomGame,
  tick,
  updateSettings,
} from '../room.ts';

const rng = seededRng(5);
const T0 = 1_000_000;

function lobby(): Room {
  let r = createRoom('K7P2QX', { id: 'host', name: 'Louca' }, rng);
  r = joinRoom(r, { id: 'ami', name: 'Hugo' }, rng).room;
  return r;
}

describe('salle d’attente', () => {
  it('code de 6 caractères sans caractères ambigus', () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode(rng)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('rejoindre, pseudo pris, table complète', () => {
    let r = lobby();
    expect(r.players.map((p) => p.name)).toEqual(['Louca', 'Hugo']);
    expect(() => joinRoom(r, { id: 'x', name: 'hugo' }, rng)).toThrow(/déjà pris/);
    r = updateSettings(r, 'host', { maxSeats: 3 });
    r = joinRoom(r, { id: 'c', name: 'Léa' }, rng).room;
    expect(() => joinRoom(r, { id: 'd', name: 'Zoé' }, rng)).toThrow(/complète/);
  });

  it("seul l'hôte règle la partie, ajoute des bots et lance", () => {
    let r = lobby();
    expect(() => updateSettings(r, 'ami', { startingStack: 500 })).toThrow(/hôte/);
    expect(() => addBot(r, 'ami', 'easy', rng)).toThrow(RoomError);
    expect(() => startRoomGame(r, 'ami', T0, rng)).toThrow(/hôte/);
    r = addBot(r, 'host', 'hard', rng);
    expect(r.players[2]).toMatchObject({ isBot: true, difficulty: 'hard' });
    expect(() => updateSettings(r, 'host', { bigBlind: 2, smallBlind: 5 })).toThrow(/Grosse blinde/);
  });

  it("l'hôte peut exclure un joueur, qui ne peut plus revenir", () => {
    let r = kickPlayer(lobby(), 'host', 'ami');
    expect(r.players).toHaveLength(1);
    expect(() => joinRoom(r, { id: 'ami', name: 'Hugo' }, rng)).toThrow(/exclu/);
  });

  it("si l'hôte part de la salle d'attente, un autre joueur devient hôte", () => {
    const r = leaveRoom(lobby(), 'host');
    expect(r.hostId).toBe('ami');
  });
});

describe('partie en ligne', () => {
  function started() {
    let r = addBot(lobby(), 'host', 'easy', rng);
    r = startRoomGame(r, 'host', T0, rng);
    return r;
  }

  it('lancement : état public sans paquet ni cartes, cartes privées seulement pour les humains', () => {
    const r = started();
    expect(r.status).toBe('playing');
    const pub = publicRoom(r);
    expect(pub.game!.deck).toEqual([]);
    expect(pub.game!.players.every((p) => p.holeCards.length === 0)).toBe(true);
    expect('banned' in pub).toBe(false);
    const priv = privateHands(r);
    expect(priv.map((h) => h.playerId).sort()).toEqual(['ami', 'host']);
    expect(priv.every((h) => h.cards.length === 2)).toBe(true);
  });

  it("refuse une action hors tour et valide côté serveur", () => {
    const r = started();
    const toAct = getLegalActions(r.game!)!.playerId;
    const other = ['host', 'ami'].find((id) => id !== toAct)!;
    expect(() => playerAction(r, other, { type: 'call' }, T0, rng)).toThrow(/pas votre tour/);
  });

  it('minuteur écoulé : action automatique et joueur marqué absent', () => {
    let r = started();
    // avance jusqu'au tour d'un humain
    let now = T0;
    while (r.deadlineKind === 'bot') {
      now = r.deadline!;
      r = tick(r, now, rng).room;
    }
    const human = getLegalActions(r.game!)!.playerId;
    expect(r.deadlineKind).toBe('turn');
    expect(r.deadline).toBe(now + 30_000);
    expect(tick(r, now + 1000, rng).changed).toBe(false); // trop tôt
    r = tick(r, r.deadline!, rng).room;
    expect(r.players.find((p) => p.id === human)!.away).toBe(true);
  });

  it('un joueur absent revient avec le même code ; un autre appareil reprend la place avec le même pseudo', () => {
    let r = started();
    r = leaveRoom(r, 'ami');
    expect(r.players.find((p) => p.id === 'ami')!.away).toBe(true);
    // même appareil
    expect(joinRoom(r, { id: 'ami', name: 'Hugo' }, rng).room.players.find((p) => p.id === 'ami')!.away).toBe(false);
    // autre appareil (nouvel identifiant) avec le même pseudo
    const res = joinRoom(r, { id: 'ami-2', name: 'Hugo' }, rng);
    expect(res.replacedId).toBe('ami');
    expect(res.room.game!.players.some((p) => p.id === 'ami-2')).toBe(true);
    // un inconnu ne peut pas entrer en cours de partie
    expect(() => joinRoom(r, { id: 'z', name: 'Zoé' }, rng)).toThrow(/déjà commencé/);
  });

  it('partie complète jouée par ticks : se termine, jetons conservés, retour en salle', () => {
    let r = updateSettings(lobby(), 'host', { startingStack: 200, turnSeconds: 10 });
    r = addBot(r, 'host', 'medium', rng);
    r = addBot(r, 'host', 'easy', rng);
    r = startRoomGame(r, 'host', T0, rng);
    const total = totalChips(r.game!);
    let now = T0;
    let steps = 0;
    while (r.status === 'playing') {
      if (++steps > 20_000) throw new Error('trop long');
      const legal = r.game!.phase === 'betting' ? getLegalActions(r.game!) : null;
      if (legal && r.deadlineKind === 'turn' && steps % 3) {
        // l'humain joue (suit/check) avant la fin du minuteur
        r = playerAction(r, legal.playerId, legal.canCheck ? { type: 'check' } : { type: 'call' }, now, rng);
      } else {
        now = r.deadline!;
        r = tick(r, now, rng).room;
      }
      expect(totalChips(r.game!)).toBe(total);
    }
    expect(r.status).toBe('finished');
    expect(r.game!.winnerId).toBeTruthy();
    r = backToLobby(r, 'host');
    expect(r.status).toBe('lobby');
    expect(r.game).toBeNull();
  });

  it("un joueur exclu en cours de partie est joué automatiquement et ne peut plus agir", () => {
    let r = started();
    r = kickPlayer(r, 'host', 'ami');
    expect(r.players.find((p) => p.id === 'ami')!.kicked).toBe(true);
    expect(() => playerAction(r, 'ami', { type: 'fold' }, T0, rng)).toThrow(/exclu/);
  });
});
