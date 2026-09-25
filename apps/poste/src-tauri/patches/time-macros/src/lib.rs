use proc_macro::TokenStream;

#[proc_macro]
pub fn time(input: TokenStream) -> TokenStream {
    time_macros_impl::time(input.into()).into()
}

#[proc_macro]
pub fn offset(input: TokenStream) -> TokenStream {
    time_macros_impl::offset(input.into()).into()
}

#[proc_macro]
pub fn date(input: TokenStream) -> TokenStream {
    time_macros_impl::date(input.into()).into()
}
