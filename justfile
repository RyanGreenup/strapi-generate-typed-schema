check:
    pnpm install
    turbo run format fix
    turbo run build lint check-types test

check-ro:
    turbo run build lint check-types test
