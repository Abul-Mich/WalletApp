export default function LimitWarningBanner({ spend, baseCurrency }) {
  if (!spend || (!spend.isNearLimit && !spend.isOverLimit)) return null

  return (
    <div className={`limit-banner ${spend.isOverLimit ? 'over' : 'near'}`}>
      {spend.isOverLimit ? (
        <>
          You're over your {spend.period} limit: {spend.spent.toFixed(2)} / {spend.limit.toFixed(2)}{' '}
          {baseCurrency}
        </>
      ) : (
        <>
          Heads up — you've used {(spend.percentUsed * 100).toFixed(0)}% of your {spend.period} limit (
          {spend.spent.toFixed(2)} / {spend.limit.toFixed(2)} {baseCurrency})
        </>
      )}
    </div>
  )
}
