import { sortPlaces, type Place, type PlaceIcon } from '../transit/store.ts';
import type { Option } from './Combobox.tsx';
import {
  Briefcase,
  Cannabis,
  Church,
  Clapperboard,
  Coffee,
  Dumbbell,
  GraduationCap,
  Heart,
  Hospital,
  House,
  Library,
  MapPin,
  Pill,
  Plane,
  ShoppingBag,
  ShoppingCart,
  Store,
  TrainFront,
  Trees,
  Users,
  Utensils,
  type LucideIcon,
} from './icons.ts';

export const PLACE_ICON_VIEWS: Record<PlaceIcon, { icon: LucideIcon; label: string }> = {
  pin: { icon: MapPin, label: 'Lugar' },
  home: { icon: House, label: 'Casa' },
  work: { icon: Briefcase, label: 'Trabajo' },
  gym: { icon: Dumbbell, label: 'Gimnasio' },
  school: { icon: GraduationCap, label: 'Escuela' },
  grocery: { icon: ShoppingCart, label: 'Súper' },
  mall: { icon: ShoppingBag, label: 'Centro comercial' },
  store: { icon: Store, label: 'Tienda' },
  cinema: { icon: Clapperboard, label: 'Cine' },
  food: { icon: Utensils, label: 'Comida' },
  coffee: { icon: Coffee, label: 'Café' },
  love: { icon: Heart, label: 'Pareja' },
  hospital: { icon: Hospital, label: 'Hospital' },
  pharmacy: { icon: Pill, label: 'Farmacia' },
  park: { icon: Trees, label: 'Parque' },
  library: { icon: Library, label: 'Biblioteca' },
  church: { icon: Church, label: 'Iglesia' },
  friends: { icon: Users, label: 'Amigos' },
  train: { icon: TrainFront, label: 'Tren' },
  airport: { icon: Plane, label: 'Aeropuerto' },
  leaf: { icon: Cannabis, label: 'Hoja' },
};

/** A place saved by a newer version may carry an icon this one does not know yet. */
export function placeIcon(icon: string): LucideIcon {
  return (PLACE_ICON_VIEWS as Record<string, { icon: LucideIcon }>)[icon]?.icon ?? MapPin;
}

/** Places as the place pickers offer them: in his order, with their icon and their tags. */
export function placeOptions(places: readonly Place[]): Option[] {
  return sortPlaces(places).map((place) => ({
    id: place.id,
    label: place.name,
    icon: placeIcon(place.icon),
    keywords: [place.tags, place.category].filter(Boolean).join(', '),
  }));
}
