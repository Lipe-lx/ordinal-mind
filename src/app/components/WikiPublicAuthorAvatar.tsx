import type { PublicAuthor } from "../lib/types"
import "../styles/features/wiki/wiki.css"

interface Props {
  author: PublicAuthor
  size?: "xs" | "sm"
  label?: string
}

export function WikiPublicAuthorAvatar({
  author,
  size = "sm",
  label,
}: Props) {
  const initials = author.username.slice(0, 2).toUpperCase()
  const title = label ? `${label}: ${author.username}` : author.username

  return (
    <span className={`wiki-public-author wiki-public-author-${size}`} title={title} aria-label={title}>
      {author.avatar_url ? (
        <img
          src={author.avatar_url}
          alt={author.username}
          className="wiki-public-author-image"
          loading="lazy"
        />
      ) : (
        <span className="wiki-public-author-placeholder">{initials}</span>
      )}
    </span>
  )
}
