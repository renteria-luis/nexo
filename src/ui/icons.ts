// The only place that imports icons, and it imports them one by one on purpose.
//
// `import { Check } from 'lucide-react-native'` reads the package index, and that
// index re-exports all 1848 icons in the pack: they all end up in the bundle and get
// registered at startup for the sake of the twenty the app actually draws. Measured on
// this project, the barrel was 1848 of the bundle's 3267 modules.
//
// Importing the icon's own module instead pulls one file each. The pack ships them
// under `lucide-react-native/icons/<kebab-name>` with a default export, which is what
// the library's own docs recommend for React Native.
//
// Adding an icon: find its name at lucide.dev/icons, add the line, keep it sorted.

export { default as Check } from 'lucide-react-native/icons/check';
export { default as ChevronDown } from 'lucide-react-native/icons/chevron-down';
export { default as ChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as ChevronUp } from 'lucide-react-native/icons/chevron-up';
export { default as Circle } from 'lucide-react-native/icons/circle';
export { default as Command } from 'lucide-react-native/icons/command';
export { default as Delete } from 'lucide-react-native/icons/delete';
export { default as Droplets } from 'lucide-react-native/icons/droplets';
export { default as Dumbbell } from 'lucide-react-native/icons/dumbbell';
export { default as Eye } from 'lucide-react-native/icons/eye';
export { default as EyeOff } from 'lucide-react-native/icons/eye-off';
export { default as Footprints } from 'lucide-react-native/icons/footprints';
// Las tres rayas: aqui no son un menu, son el asa de arrastre de una lista.
export { default as GripLines } from 'lucide-react-native/icons/menu';
export { default as Info } from 'lucide-react-native/icons/info';
export { default as LayoutGrid } from 'lucide-react-native/icons/layout-grid';
export { default as LoaderCircle } from 'lucide-react-native/icons/loader-circle';
export { default as MapPin } from 'lucide-react-native/icons/map-pin';
export { default as Minus } from 'lucide-react-native/icons/minus';
export { default as Moon } from 'lucide-react-native/icons/moon';
export { default as Pencil } from 'lucide-react-native/icons/pencil';
export { default as Pill } from 'lucide-react-native/icons/pill';
export { default as Play } from 'lucide-react-native/icons/play';
export { default as Plus } from 'lucide-react-native/icons/plus';
export { default as RotateCcw } from 'lucide-react-native/icons/rotate-ccw';
export { default as Scale } from 'lucide-react-native/icons/scale';
export { default as Search } from 'lucide-react-native/icons/search';
export { default as Settings } from 'lucide-react-native/icons/settings';
export { default as Tag } from 'lucide-react-native/icons/tag';
export { default as Timer } from 'lucide-react-native/icons/timer';
export { default as Trash } from 'lucide-react-native/icons/trash';
export { default as TriangleAlert } from 'lucide-react-native/icons/triangle-alert';
export { default as Users } from 'lucide-react-native/icons/users';
export { default as Utensils } from 'lucide-react-native/icons/utensils';
export { default as Wallet } from 'lucide-react-native/icons/wallet';
export { default as Wine } from 'lucide-react-native/icons/wine';
export { default as X } from 'lucide-react-native/icons/x';

// Solo el tipo, que se borra al compilar y no arrastra nada al paquete.
export type { LucideIcon } from 'lucide-react-native';
