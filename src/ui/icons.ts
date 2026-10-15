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

export { default as ArrowUpDown } from 'lucide-react-native/icons/arrow-up-down';
export { default as Ban } from 'lucide-react-native/icons/ban';
export { default as BookOpen } from 'lucide-react-native/icons/book-open';
export { default as Briefcase } from 'lucide-react-native/icons/briefcase';
export { default as Bus } from 'lucide-react-native/icons/bus';
export { default as CalendarClock } from 'lucide-react-native/icons/calendar-clock';
export { default as CalendarDays } from 'lucide-react-native/icons/calendar-days';
export { default as Cannabis } from 'lucide-react-native/icons/cannabis';
export { default as Carrot } from 'lucide-react-native/icons/carrot';
export { default as ChartLine } from 'lucide-react-native/icons/chart-line';
export { default as Check } from 'lucide-react-native/icons/check';
export { default as ChefHat } from 'lucide-react-native/icons/chef-hat';
export { default as ChevronDown } from 'lucide-react-native/icons/chevron-down';
export { default as ChevronLeft } from 'lucide-react-native/icons/chevron-left';
export { default as ChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as ChevronUp } from 'lucide-react-native/icons/chevron-up';
export { default as Church } from 'lucide-react-native/icons/church';
export { default as Circle } from 'lucide-react-native/icons/circle';
export { default as CircleSlash } from 'lucide-react-native/icons/circle-slash';
export { default as Clapperboard } from 'lucide-react-native/icons/clapperboard';
export { default as Coffee } from 'lucide-react-native/icons/coffee';
export { default as Command } from 'lucide-react-native/icons/command';
export { default as Droplets } from 'lucide-react-native/icons/droplets';
export { default as Dumbbell } from 'lucide-react-native/icons/dumbbell';
export { default as ExternalLink } from 'lucide-react-native/icons/external-link';
export { default as Eye } from 'lucide-react-native/icons/eye';
export { default as EyeOff } from 'lucide-react-native/icons/eye-off';
export { default as FlaskConical } from 'lucide-react-native/icons/flask-conical';
export { default as Footprints } from 'lucide-react-native/icons/footprints';
export { default as Globe } from 'lucide-react-native/icons/globe';
export { default as GraduationCap } from 'lucide-react-native/icons/graduation-cap';
export { default as GripLines } from 'lucide-react-native/icons/menu';
export { default as Heart } from 'lucide-react-native/icons/heart';
export { default as History } from 'lucide-react-native/icons/rotate-ccw-clock';
export { default as Hospital } from 'lucide-react-native/icons/hospital';
export { default as House } from 'lucide-react-native/icons/house';
export { default as Info } from 'lucide-react-native/icons/info';
export { default as LayoutGrid } from 'lucide-react-native/icons/layout-grid';
export { default as Library } from 'lucide-react-native/icons/library';
export { default as Lightbulb } from 'lucide-react-native/icons/lightbulb';
export { default as List } from 'lucide-react-native/icons/list';
export { default as LoaderCircle } from 'lucide-react-native/icons/loader-circle';
export { default as MapPin } from 'lucide-react-native/icons/map-pin';
export { default as Menu } from 'lucide-react-native/icons/menu';
export { default as Minus } from 'lucide-react-native/icons/minus';
export { default as Moon } from 'lucide-react-native/icons/moon';
export { default as Navigation } from 'lucide-react-native/icons/navigation';
export { default as Pencil } from 'lucide-react-native/icons/pencil';
export { default as Pill } from 'lucide-react-native/icons/pill';
export { default as Plane } from 'lucide-react-native/icons/plane';
export { default as Play } from 'lucide-react-native/icons/play';
export { default as Plus } from 'lucide-react-native/icons/plus';
export { default as Radio } from 'lucide-react-native/icons/radio';
export { default as RefreshCw } from 'lucide-react-native/icons/refresh-cw';
export { default as Refrigerator } from 'lucide-react-native/icons/refrigerator';
export { default as RotateCcw } from 'lucide-react-native/icons/rotate-ccw';
export { default as Scale } from 'lucide-react-native/icons/scale';
export { default as Search } from 'lucide-react-native/icons/search';
export { default as Send } from 'lucide-react-native/icons/send';
export { default as Settings } from 'lucide-react-native/icons/settings';
export { default as ShoppingBag } from 'lucide-react-native/icons/shopping-bag';
export { default as ShoppingCart } from 'lucide-react-native/icons/shopping-cart';
export { default as Store } from 'lucide-react-native/icons/store';
export { default as Sun } from 'lucide-react-native/icons/sun';
export { default as Sunrise } from 'lucide-react-native/icons/sunrise';
export { default as Sunset } from 'lucide-react-native/icons/sunset';
export { default as Tag } from 'lucide-react-native/icons/tag';
export { default as Timer } from 'lucide-react-native/icons/timer';
export { default as TrainFront } from 'lucide-react-native/icons/train-front';
export { default as Trash } from 'lucide-react-native/icons/trash';
export { default as Trees } from 'lucide-react-native/icons/trees';
export { default as TriangleAlert } from 'lucide-react-native/icons/triangle-alert';
export { default as Users } from 'lucide-react-native/icons/users';
export { default as Utensils } from 'lucide-react-native/icons/utensils';
export { default as Wallet } from 'lucide-react-native/icons/wallet';
export { default as Wine } from 'lucide-react-native/icons/wine';
export { default as X } from 'lucide-react-native/icons/x';

// Solo el tipo, que se borra al compilar y no arrastra nada al paquete.
export type { LucideIcon } from 'lucide-react-native';
