/* Standards (web-design): TYP-11 Organised type: fixed roles, one rhythm · LAY-2 Proximity carries the grouping */
import { cn } from "@/lib/utils"
import { Eyebrow, Heading, Lead } from "@/components/marketing/type"

/* One rhythm for every section opening (TYP-11: the same gaps
   everywhere): label → title 16 px, title → lead 24 px. Hero sizes use `hero`. */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  id,
  level = 2,
  hero = false,
  className,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  lead?: React.ReactNode
  id?: string
  level?: 1 | 2
  hero?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {eyebrow && <Eyebrow className={hero ? "mb-6" : "mb-4"}>{eyebrow}</Eyebrow>}
      <Heading level={level} id={id} data-rank={level === 1 ? "1" : undefined}>{title}</Heading>
      {lead && <Lead className={hero ? "mt-8" : "mt-6"}>{lead}</Lead>}
    </div>
  )
}
