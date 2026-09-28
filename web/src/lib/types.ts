export type Signo = "1" | "X" | "2";
export type Pleno = "0" | "1" | "2" | "M";
export type EstadoJornada = "abierta" | "en_juego" | "finalizada";

export interface Perfil {
  id: string;
  nombre: string;
  created_at: string;
}

export interface Jornada {
  id: number;
  temporada: string;
  numero: number;
  fecha: string;
  cierre: string | null;
  estado: EstadoJornada;
  oficial: boolean;
}

export interface Partido {
  id: number;
  jornada_id: number;
  posicion: number;
  local: string;
  visitante: string;
  inicio: string | null;
  fixture_id: number | null;
  goles_local: number | null;
  goles_visitante: number | null;
  estado: string;
  signo_oficial: Signo | null;
  pleno_oficial_local: Pleno | null;
  pleno_oficial_visitante: Pleno | null;
  signo: Signo | null;
  pleno_local: Pleno | null;
  pleno_visitante: Pleno | null;
  terminado: boolean;
}

export interface Apuesta {
  id: number;
  jornada_id: number;
  user_id: string;
  signos: string;
  pleno_local: Pleno;
  pleno_visitante: Pleno;
  updated_at: string;
}

export interface DueloJornada {
  jornada_id: number;
  temporada: string;
  numero: number;
  fecha: string;
  estado: EstadoJornada;
  oficial: boolean;
  user_id: string;
  aciertos: number;
  participantes: number;
  resultado: "ganada" | "empate" | "perdida" | null;
}

export interface Clasificacion {
  temporada: string;
  user_id: string;
  nombre: string;
  jornadas_jugadas: number;
  aciertos_totales: number;
  media_aciertos: number;
  mejor_jornada: number;
  ganadas: number;
  empates: number;
  perdidas: number;
}
