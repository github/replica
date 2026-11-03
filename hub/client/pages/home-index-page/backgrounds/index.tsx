import "./styles.css"

const graphicModules = import.meta.glob<string>("./assets/*.png", {
  eager: true,
  import: "default",
})

const treatmentSlugs = ["curved-front-offset", "linear-gradient", "curved-front"] as const

const graphics = Object.entries(graphicModules)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, src]) => {
    const fileName =
      path
        .split("/")
        .at(-1)
        ?.replace(/\.png$/, "") ?? path
    const graphicName = fileName.replace(/^\d+-/, "")
    const treatmentSlug =
      treatmentSlugs.find((treatment) => graphicName.startsWith(`${treatment}-`)) ?? "illustration"
    const paletteSlug = graphicName.slice(treatmentSlug.length + 1)

    return {
      fileName,
      palette: toLabel(paletteSlug),
      src,
      treatment: toLabel(treatmentSlug),
    }
  })

export function BackgroundsGallery() {
  return (
    <main className="backgrounds">
      <header className="backgrounds__header">
        <p className="backgrounds__eyebrow">Replica</p>
        <h1>Backgrounds</h1>
        <p>30 backgrounds at 1920 × 1080, grouped by palette and illustration treatment.</p>
      </header>

      <div className="backgrounds__grid">
        {graphics.map((graphic) => (
          <figure className="backgrounds__item" key={graphic.fileName}>
            <img
              alt={`${graphic.palette} ${graphic.treatment} Replica graphic`}
              loading="lazy"
              src={graphic.src}
            />
            <figcaption>
              <strong>{graphic.palette}</strong>
              <span>{graphic.treatment}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  )
}

function toLabel(value: string) {
  const label = value.replaceAll("-", " ")
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}
