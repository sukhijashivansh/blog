import { other } from './config.js';

const POINTS = 11;
const award = (winner, reason) => ({ type: 'point', winner, reason });
const replay = reason => ({ type: 'let', reason });

/* ---------- match: to 11, win by 2, serve swaps every 2 points and every point from 10-10 ---------- */
export class Match {
  constructor(bestOf, firstServer) {
    this.bestOf = bestOf;
    this.needed = Math.ceil(bestOf / 2);
    this.games = [0, 0];
    this.score = [0, 0];
    this.firstServer = firstServer;
    this.history = [];
    this.winner = null;
  }

  get server() {
    const played = this.score[0] + this.score[1];
    const turn = played < 20 ? Math.floor(played / 2) : played - 20;
    return turn % 2 === 0 ? this.firstServer : other(this.firstServer);
  }

  get deuce() { return this.score[0] >= 10 && this.score[1] >= 10; }

  point(winner) {
    this.score[winner]++;
    const [a, b] = this.score;
    if (Math.max(a, b) < POINTS || Math.abs(a - b) < 2) return { gameOver: false, matchOver: false };
    this.games[winner]++;
    this.history.push([a, b]);
    const matchOver = this.games[winner] >= this.needed;
    if (matchOver) this.winner = winner;
    return { gameOver: true, matchOver };
  }

  // whoever served first in this game receives first in the next
  nextGame() {
    this.score = [0, 0];
    this.firstServer = other(this.firstServer);
  }
}

/* ---------- rally referee: each method returns a call, or null while play goes on ---------- */
export class Rally {
  constructor(server) {
    this.server = server;
    this.receiver = other(server);
    this.phase = 'toss';
    this.striker = null;
    this.netTouch = false;
    this.shots = 0;
  }

  strike(who, headedToCourt = false) {
    const { server, receiver, striker } = this;
    switch (this.phase) {
      case 'toss':
        this.phase = 'serve-own'; this.striker = who; this.shots = 1;
        return null;
      case 'serve-own':
        return award(receiver, 'Serve never bounced on the server\'s side');
      case 'serve-cross':
        if (this.netTouch) return replay('Let: net serve');
        return headedToCourt ? award(server, 'Hit before it bounced') : award(receiver, 'Serve was going out');
      case 'flying':
        if (who === striker) return award(other(who), 'Double hit');
        return headedToCourt ? award(striker, 'Hit before it bounced') : award(who, 'Ball was going out');
      default:
        if (who === striker) return award(who, 'Not returned');
        this.striker = who; this.phase = 'flying'; this.shots++;
        return null;
    }
  }

  table(side) {
    const { server, receiver, striker } = this;
    switch (this.phase) {
      case 'toss':
        return award(receiver, 'Missed the serve');
      case 'serve-own':
        if (side !== server) return award(receiver, 'Serve must bounce on the server\'s side first');
        this.phase = 'serve-cross';
        return null;
      case 'serve-cross':
        if (side === server) return award(receiver, 'Serve did not cross the net');
        if (this.netTouch) return replay('Let: net serve');
        this.phase = 'bounced';
        return null;
      case 'flying':
        if (side === striker) return award(other(striker), 'Ball did not cross the net');
        this.phase = 'bounced';
        return null;
      default:
        return award(striker, side === striker ? 'Not returned' : 'Double bounce');
    }
  }

  net() {
    if (this.phase === 'serve-own' || this.phase === 'serve-cross') this.netTouch = true;
    return null;
  }

  dead() {
    const { receiver, striker } = this;
    switch (this.phase) {
      case 'toss': return award(receiver, 'Missed the serve');
      case 'serve-own':
      case 'serve-cross': return award(receiver, 'Serve missed the table');
      case 'flying': return award(other(striker), 'Out');
      default: return award(striker, 'Not returned');
    }
  }
}
