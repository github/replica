import type { HomePageProps } from "./types"

export function HomePage({ aboutLink }: HomePageProps) {
  return (
    <main>
      <h1>Replica Starter</h1>
      <p>This is the start page. Replace it with your prototype's landing screen.</p>
      {aboutLink}
    </main>
  )
}
