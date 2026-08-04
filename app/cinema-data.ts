export interface Seat {
  id: string;
  row: string;
  number: number;
  type: 'standard' | 'vip' | 'accessible' | 'couple';
  price: number;
  status: 'available' | 'reserved' | 'selected' | 'blocked';
}

export interface Auditorium {
  id: string;
  name: string;
  type: 'IMAX 3D' | 'Dolby Cinema' | 'VIP Lounge' | '4DX Experience' | 'Standard Screen';
  screenSize: string;
  soundSystem: string;
  capacity: number;
  rows: number;
  cols: number;
  movieTitle: string;
  moviePoster: string;
  showtimes: string[];
  description: string;
}

export const auditoriums: Auditorium[] = [
  {
    id: "auditorium-1",
    name: "Auditorium 1 - Grand IMAX",
    type: "IMAX 3D",
    screenSize: "22m x 12m Dual Laser",
    soundSystem: "Dolby Atmos 12-Channel",
    capacity: 120,
    rows: 8,
    cols: 15,
    movieTitle: "Interstellar Horizon 2",
    moviePoster: "https://picsum.photos/seed/cinema1/400/600",
    showtimes: ["14:00", "17:30", "20:45"],
    description: "Our flagship IMAX screen featuring dual 4K laser projection and immersive 12-channel surround sound."
  },
  {
    id: "auditorium-2",
    name: "Auditorium 2 - Dolby Prime",
    type: "Dolby Cinema",
    screenSize: "18m x 9.5m Premium Large",
    soundSystem: "Dolby Atmos Spatial",
    capacity: 96,
    rows: 8,
    cols: 12,
    movieTitle: "Cyberpunk Echoes",
    moviePoster: "https://picsum.photos/seed/cinema2/400/600",
    showtimes: ["13:15", "16:00", "19:15", "22:00"],
    description: "Unmatched contrast ratio with dual HDR projection and reclining leather seats."
  },
  {
    id: "auditorium-3",
    name: "Auditorium 3 - VIP Suite",
    type: "VIP Lounge",
    screenSize: "14m x 7.5m 4K Laser",
    soundSystem: "7.1 Surround Sound",
    capacity: 48,
    rows: 6,
    cols: 8,
    movieTitle: "The Last Symphony",
    moviePoster: "https://picsum.photos/seed/cinema3/400/600",
    showtimes: ["15:00", "18:30", "21:15"],
    description: "Exclusive luxury seating with waiter service, heated recliners, and side tables."
  }
];

export function getAuditoriumById(id: string): Auditorium | undefined {
  return auditoriums.find((aud) => aud.id === id);
}
