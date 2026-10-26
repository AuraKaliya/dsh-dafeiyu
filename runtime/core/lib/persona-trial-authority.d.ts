import type { PersonaAccess, PersonaTrialAuthority } from '#dafeiyu/contracts';
/** A guard function is not a grant: identity and the exact callback payload are checked separately. */
export declare class PersonaTrialAuthorities {
    private readonly grants;
    invoke<Input, Result>(input: Input, access: PersonaAccess, verify: () => void, receive: (input: Input, authority: PersonaTrialAuthority) => Result): Result;
    assert(authority: unknown, input: unknown): void;
    access(authority: unknown, input: unknown): PersonaAccess;
}
