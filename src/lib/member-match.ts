export type NamedMember = { userId: string; name: string };

const SELF = new Set(["me", "i", "myself", "you", "main", "mujhe", "maine", "mera", "meri"]);

export function matchMember(people: NamedMember[], ref: string, selfId: string): NamedMember {
  const key = ref.trim().toLowerCase();
  if (!key || SELF.has(key)) {
    const self = people.find((person) => person.userId === selfId);
    if (!self) throw new Error("You're not on this project");
    return self;
  }
  const exact = people.filter((person) => person.userId === ref || person.name.toLowerCase() === key);
  if (exact.length === 1) return exact[0]!;
  const fuzzy = people.filter((person) => {
    const name = person.name.toLowerCase();
    return name.includes(key) || key.includes(name);
  });
  const names = people.map((person) => person.name).join(", ");
  if (exact.length > 1 || fuzzy.length > 1) {
    throw new Error(`Which person: ${names}?`);
  }
  if (fuzzy.length === 1) return fuzzy[0]!;
  throw new Error(names ? `No one named "${ref}" on this project. People: ${names}.` : "No one else is on this project yet.");
}
