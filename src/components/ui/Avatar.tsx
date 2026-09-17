import { Sparkles } from 'lucide-react';
import type { Person } from '../../../shared/types';
import { cx, initials } from '../../lib/format';

export function Avatar({ person, size = 28 }: { person: Person | undefined; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) };
  if (!person) {
    return (
      <span className="avatar" style={{ ...style, background: '#c4c4c4' }}>
        ?
      </span>
    );
  }
  return (
    <span className={cx('avatar', person.isAgent && 'avatar--agent')} style={{ ...style, background: person.color }} title={person.name}>
      {person.isAgent ? <Sparkles size={Math.round(size * 0.55)} strokeWidth={2.2} /> : initials(person.name)}
    </span>
  );
}

export function AvatarStack({ people, max = 3, size = 26 }: { people: Person[]; max?: number; size?: number }) {
  const shown = people.slice(0, people.length > max ? max - 1 : max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {extra > 0 && (
        <span
          className="avatar-more"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
          title={people
            .slice(shown.length)
            .map((p) => p.name)
            .join(', ')}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
