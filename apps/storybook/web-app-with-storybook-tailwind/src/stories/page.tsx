import type { Component } from "solid-js";

import { createSignal } from "solid-js";

import type { User } from "./header";

import { Header } from "./header";

const Tip: Component = () => (
  <div class="my-10 text-[13px] leading-5">
    <span class="mr-2.5 inline-block rounded-[1em] bg-[#e7fdd8] px-3 py-1 align-top text-[11px] leading-3 font-bold text-[#357a14]">
      Tip
    </span>{" "}
    Adjust the width of the canvas with the{" "}
    <svg
      class="mt-[3px] mr-1 inline-block size-3 align-top"
      width="10"
      height="10"
      viewBox="0 0 12 12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="none" fill-rule="evenodd">
        <path
          d="M1.5 5.2h4.8c.3 0 .5.2.5.4v5.1c-.1.2-.3.3-.4.3H1.4a.5.5 0 01-.5-.4V5.7c0-.3.2-.5.5-.5zm0-2.1h6.9c.3 0 .5.2.5.4v7a.5.5 0 01-1 0V4H1.5a.5.5 0 010-1zm0-2.1h9c.3 0 .5.2.5.4v9.1a.5.5 0 01-1 0V2H1.5a.5.5 0 010-1zm4.3 5.2H2V10h3.8V6.2z"
          id="a"
          fill="#1ea7fd"
        />
      </g>
    </svg>
    Viewports addon in the toolbar
  </div>
);

export const Page: Component = () => {
  const [user, setUser] = createSignal<User>();

  return (
    <article>
      <Header
        user={user()}
        onLogin={() => {
          setUser({ name: "Jane Doe" });
        }}
        onLogout={() => {
          setUser(undefined);
        }}
        onCreateAccount={() => {
          setUser({ name: "Jane Doe" });
        }}
      />

      <section class="mx-auto max-w-[600px] px-5 py-12 font-sans text-sm leading-6 text-[#333]">
        <h2 class="mb-1 inline-block align-top text-[32px] leading-none font-bold">
          Pages in Storybook
        </h2>
        <p class="my-[1em]">
          We recommend building UIs with a{" "}
          <a
            class="text-inherit"
            href="https://componentdriven.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>component-driven</strong>
          </a>{" "}
          process starting with atomic components and ending with pages.
        </p>
        <p class="my-[1em]">
          Render pages with mock data. This makes it easy to build and review
          page states without needing to navigate to them in your app. Here are
          some handy patterns for managing page data in Storybook:
        </p>
        <ul class="my-[1em] pl-[30px]">
          <li class="mb-2">
            Use a higher-level connected component. Storybook helps you compose
            such data from the "args" of child component stories
          </li>
          <li class="mb-2">
            Assemble data in the page component from your services. You can mock
            these services out using Storybook.
          </li>
        </ul>
        <p class="my-[1em]">
          Get a guided tutorial on component-driven development at{" "}
          <a
            class="text-inherit"
            href="https://storybook.js.org/tutorials/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Storybook tutorials
          </a>
          . Read more in the{" "}
          <a
            class="text-inherit"
            href="https://storybook.js.org/docs"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs
          </a>
          .
        </p>
        <Tip />
      </section>
    </article>
  );
};
