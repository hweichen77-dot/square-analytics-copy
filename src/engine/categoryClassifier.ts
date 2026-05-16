export const ALL_CATEGORY_NAMES = ['Food', 'Drinks', 'Ice Cream', 'Ramen/Hot Food', 'Merch', 'Other'] as const
export type Category = typeof ALL_CATEGORY_NAMES[number]

const FOOD_KEYWORDS = [
  'takis', 'chips', 'doritos', 'cheetos', 'lays', 'pretzels', 'popcorn',
  'candy', 'gummy', 'chocolate', 'snickers', 'kitkat', 'reeses', 'skittles',
  'starburst', 'jolly rancher', 'nerds', 'haribo', 'cookie', 'brownie',
  'muffin', 'cracker', 'goldfish', 'oreo', 'rice crispy', 'granola', 'bar',
  'trail mix', 'beef jerky', 'jerky', 'slim jim', 'hot pocket', 'sandwich',
  'wrap', 'salad', 'fruit', 'apple', 'banana', 'orange', 'snack',
]

const DRINKS_KEYWORDS = [
  'water', 'gatorade', 'powerade', 'juice', 'lemonade', 'tea', 'coffee',
  'monster', 'redbull', 'red bull', 'bang', 'celsius', 'bodyarmor', 'body armor',
  'snapple', 'arizona', 'vitamin water', 'vitaminwater', 'sparkling', 'soda',
  'coke', 'pepsi', 'sprite', 'fanta', 'dr pepper', 'mountain dew', 'dew',
  'drink', 'beverage', 'smoothie', 'shake', 'milk', 'chocolate milk',
]

const ICE_CREAM_KEYWORDS = [
  'ice cream', 'popsicle', 'freeze pop', 'drumstick', 'klondike',
  'fudge bar', 'creamsicle', 'sorbet', 'gelato', 'frozen yogurt', 'froyo',
  'dippin dots', 'ice pop',
]

const RAMEN_KEYWORDS = [
  'ramen', 'noodle', 'instant noodle', 'cup noodle', 'maruchan',
  'nissin', 'top ramen', 'soup', 'hot food', 'nachos', 'pretzel dog',
  'hot dog', 'pizza', 'quesadilla', 'mac', 'macaroni',
]

export const MERCH_KEYWORDS = [
  'shirt', 't-shirt', 'hoodie', 'sweatshirt', 'jacket', 'hat', 'cap', 'beanie',
  'bag', 'backpack', 'lanyard', 'keychain', 'sticker', 'pen', 'pencil',
  'notebook', 'binder', 'folder', 'merch', 'merchandise', 'apparel', 'gear',
  'bracelet', 'wristband', 'pin', 'button', 'magnet', 'poster', 'flag',
]

export function classifyProduct(name: string, overrides: Record<string, string> = {}): string {
  if (overrides[name]) return overrides[name]
  const lower = name.toLowerCase()
  if (ICE_CREAM_KEYWORDS.some(k => lower.includes(k))) return 'Ice Cream'
  if (RAMEN_KEYWORDS.some(k => lower.includes(k))) return 'Ramen/Hot Food'
  if (DRINKS_KEYWORDS.some(k => lower.includes(k))) return 'Drinks'
  if (FOOD_KEYWORDS.some(k => lower.includes(k))) return 'Food'
  if (MERCH_KEYWORDS.some(k => lower.includes(k))) return 'Merch'
  return 'Other'
}
