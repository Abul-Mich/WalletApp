import { formatUsd, formatPercent } from '../lib/format'
export default function LimitWarningBanner({ spend }) {
  if (!spend || (!spend.isNearLimit && !spend.isOverLimit)) return null

  return (
    <div className={`limit-banner ${spend.isOverLimit ? 'over' : 'near'}`}>
      {spend.isOverLimit ? (
        <>
          You're over your {spend.period} limit: {formatUsd(spend.spent)} / {formatUsd(spend.limit)}
        </>
      ) : (
        <>
          Heads up — you've used {formatPercent(spend.percentUsed)} of your {spend.period} limit (
          {formatUsd(spend.spent)} / {formatUsd(spend.limit)})
        </>
      )}
    </div>
  )
}
