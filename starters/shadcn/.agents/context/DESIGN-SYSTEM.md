# Shadcn design system

## Shared defaults

Use installed shadcn/ui components from `src/components/ui/`, the official dashboard components in `src/components/` and semantic Tailwind tokens from `src/index.css`. The starter uses Radix UI. Read `components.json`, the [official skill](../skills/shadcn/SKILL.md) and actual installed exports before choosing APIs. Do not apply Base UI composition examples to Radix components.

The [official documentation](https://ui.shadcn.com/docs) explains current patterns; installed sources define the available APIs. Additional registry installation or preset changes are intentional dependency changes, not routine startup actions.

## States and feedback

Use existing Card, Field, Alert and Dialog compositions. Keep native form labels and dialog titles meaningful. Show an actionable empty search state. Report a save only after browser storage succeeds, and expose failures as alerts. Reuse the current example before inventing a new visual pattern.

## Limitations

This is example-app guidance, not a team's brand specification. Resolve a request for another design system or unsupported component behavior before substituting a new system.
