import {AuthServiceWorker} from "../../interfaces";
import {
  getOpenIdConfiguration,
  ConfigurationReponse,
} from "../openid-configurations";
import {TokenResponse} from "../session-manager";

export class OAuthTokenClient {
  constructor(
    private serviceWorker: AuthServiceWorker,
    config: ConfigurationReponse | string,
  ) {
    this.#tokens = new Map<string, JwtToken>()
    if (typeof config === "string") {
      this.#oAuthConfig = getOpenIdConfiguration(serviceWorker, config);
    } else {
      this.#oAuthConfig = Promise.resolve(config);
    }
  }
  #oAuthConfig: Promise<ConfigurationReponse>;

  #tokens: Map<string, JwtToken>;

  public async getAccessToken(sessionId: string, authClientId: string) {
    await this.#oAuthConfig;
    let tokens = await this.serviceWorker.sessionManager.getToken(
      sessionId,
      authClientId,
    );
    if (!tokens) {
      tokens = await this.#authorize(authClientId);
    }
    if (this.#tokens.get(tokens.access_token)) {
      return this.#tokens.get(tokens.access_token);
    }
    const accessToken = new JwtToken(tokens.access_token);
    this.#tokens.set(tokens.access_token, accessToken);
    return accessToken;
  }

  async #authorize(authClientId: string): Promise<TokenResponse> {
    console.log(authClientId);
    return null;
  }
}


export class JwtToken {
  constructor(private token: string) {}

  public getClaims() {
    return JSON.parse(atob(this.token.split(".")[1]));
  }

  public toString() {
    return this.token;
  }

}
