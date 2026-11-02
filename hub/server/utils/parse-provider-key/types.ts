declare const providerKeyBrand: unique symbol

export type ProviderKey = string & { readonly [providerKeyBrand]: true }
