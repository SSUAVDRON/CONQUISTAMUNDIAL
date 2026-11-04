// Un ataque es un "frente" de casillas candidatas que el atacante va
// conquistando tick a tick mientras le queden tropas. La lógica de avance vive
// en Game; aquí solo está el estado.
import { MinHeap } from './heap.js';

export class Attack {
  constructor(attacker, targetId, troops) {
    this.attacker = attacker;
    this.targetId = targetId; // 0 = tierra libre
    /** Casilla hacia la que avanza (donde se hizo clic); -1 = en todas direcciones. */
    this.focus = -1;
    /** Centro del frente y dirección hacia el clic (vector unitario). */
    this.cx = 0;
    this.cy = 0;
    this.dx = 0;
    this.dy = 0;
    this.troops = troops;
    this.heap = new MinHeap();
    /** Casillas presentes en el montículo (evita duplicados). */
    this.inFrontier = new Set();
    this.step = 0;
    this.budget = 0;
    this.done = false;
    /** Orden: 'rapido' | 'normal' | 'preparado'; el preparado no avanza hasta readyAt. */
    this.mode = 'normal';
    this.readyAt = 0;
    /** Avance continuo: fracción de soldados con la que se refuerza cada pocos segundos (0 = no). */
    this.auto = 0;
  }
}
