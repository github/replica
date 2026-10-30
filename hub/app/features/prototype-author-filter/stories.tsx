import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { fn } from "storybook/test"

import { prototypeListing } from "@/storybook/fixtures/prototype-listing"
import { mona } from "@/storybook/fixtures/users"

import { PrototypeAuthorFilter } from "."

const meta = {
  title: "Features/Prototype Author Filter",
  component: PrototypeAuthorFilter,
  args: {
    listing: prototypeListing,
    onChange: fn(),
    onSearch: fn(() =>
      Promise.resolve({
        authors: [{ id: "2", ...mona }],
        nextCursor: null,
      }),
    ),
  },
  render: function AuthorFilterStory(args) {
    const [author, setAuthor] = useState(args.listing.author)
    return (
      <PrototypeAuthorFilter
        {...args}
        listing={{
          ...args.listing,
          author,
          authorLabel:
            author === args.listing.author
              ? args.listing.authorLabel
              : author === "me"
                ? "Me"
                : author === "2"
                  ? `@${mona.login}`
                  : "All authors",
        }}
        onChange={(value) => {
          setAuthor(value)
          args.onChange(value)
        }}
      />
    )
  },
} satisfies Meta<typeof PrototypeAuthorFilter>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { onSearch: fn(() => Promise.resolve({ authors: [], nextCursor: null })) },
}

export const Single: Story = {}

export const Me: Story = {
  args: { listing: { ...prototypeListing, author: "me", authorLabel: "Me" } },
}

export const LongAuthor: Story = {
  args: {
    listing: {
      ...prototypeListing,
      author: "2",
      authorLabel: `${mona.name} (@${mona.login})`.repeat(5),
    },
    onSearch: fn((_query: string, cursor: string | null) =>
      Promise.resolve({
        authors: [{ id: "2", ...mona, name: mona.name.repeat(10) }],
        nextCursor: cursor ? null : "next",
      }),
    ),
  },
}

export const Failed: Story = {
  args: {
    onSearch: fn(() => Promise.reject(new Error("Unavailable"))),
  },
}

export const Loading: Story = {
  args: { onSearch: fn(() => new Promise(() => {})) },
}
