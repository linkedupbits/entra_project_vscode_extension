# Overview


The following is a manifest that provides highly-priviedged readonly access for a user to connect to the tenancy and browse a connection: 

```json
{
	"deletedDateTime": null,
	"applicationTemplateId": "8adf8e6e-67b2-4cf2-a259-e3dc5476c621",
	"disabledByMicrosoftStatus": null,
	"createdByAppId": "f0ae4899-d877-4d3c-ae25-679e38eea492",
	"createdDateTime": "2026-09-06T21:26:17Z",
	"displayName": "ITOps_Entra_VSCodeExtension",
	"description": null,
	"groupMembershipClaims": null,
	"identifierUris": [],
	"isDeviceOnlyAuthSupported": null,
	"isDisabled": null,
	"isFallbackPublicClient": true,
	"nativeAuthenticationApisEnabled": null,
	"notes": null,
	"publisherDomain": "nzxsmartnonprod.onmicrosoft.com",
	"serviceManagementReference": null,
	"signInAudience": "AzureADMyOrg",
	"tags": [],
	"tokenEncryptionKeyId": null,
	"samlMetadataUrl": null,
	"defaultRedirectUri": null,
	"certification": null,
	"optionalClaims": null,
	"requestSignatureVerification": null,
	"addIns": [],
	"api": {
		"acceptMappedClaims": null,
		"knownClientApplications": [],
		"requestedAccessTokenVersion": 2,
		"oauth2PermissionScopes": [
			{
				"adminConsentDescription": "Allow the application to access ITOps_Entra_VSCodeExtension on behalf of the signed-in user",
				"adminConsentDisplayName": "Access ITOps_Entra_VSCodeExtension",
				"id": "e366c922-7c5a-4678-bb82-06e82f0d16f0",
				"isEnabled": true,
				"type": "User",
				"userConsentDescription": "Allow the application to access ITOps_Entra_VSCodeExtension on your behalf.",
				"userConsentDisplayName": "Access ITOps_Entra_VSCodeExtension",
				"value": "user_impersonation"
			}
		],
		"preAuthorizedApplications": []
	},
	"appRoles": [
		{
			"allowedMemberTypes": [
				"User"
			],
			"description": "User",
			"displayName": "User",
			"id": "18d14569-c3bd-439b-9a66-3a2aee01d14f",
			"isEnabled": true,
			"origin": "Application",
			"value": null
		},
		{
			"allowedMemberTypes": [
				"User"
			],
			"description": "msiam_access",
			"displayName": "msiam_access",
			"id": "b9632174-c057-4f7e-951b-be3adc52bfe6",
			"isEnabled": true,
			"origin": "Application",
			"value": null
		}
	],
	"info": {
		"logoUrl": null,
		"marketingUrl": null,
		"privacyStatementUrl": null,
		"supportUrl": null,
		"termsOfServiceUrl": null
	},
	"keyCredentials": [],
	"parentalControlSettings": {
		"countriesBlockedForMinors": [],
		"legalAgeGroupRule": "Allow"
	},
	"passwordCredentials": [],
	"publicClient": {
		"redirectUris": [
			"http://localhost:4859"
		]
	},
	"requiredResourceAccess": [
		{
			"resourceAppId": "00000003-0000-0000-c000-000000000000",
			"resourceAccess": [
				{
					"id": "c79f8feb-a9db-4090-85f9-90d820caa0eb",
					"type": "Scope"
				},
				{
					"id": "06da0dbc-49e2-44d2-8312-53f166ab848a",
					"type": "Scope"
				},
				{
					"id": "5f8c59db-677d-491f-a6b8-5f174b11ec1d",
					"type": "Scope"
				},
				{
					"id": "a154be20-db9c-4678-8ab7-66f6cc099a59",
					"type": "Scope"
				}
			]
		}
	],
	"verifiedPublisher": {
		"displayName": null,
		"verifiedPublisherId": null,
		"addedDateTime": null
	},
	"web": {
		"homePageUrl": "https://account.activedirectory.windowsazure.com:444/applications/default.aspx?metadata=customappsso|ISV9.1|primary|z",
		"logoutUrl": null,
		"redirectUris": [],
		"implicitGrantSettings": {
			"enableAccessTokenIssuance": false,
			"enableIdTokenIssuance": false
		},
		"redirectUriSettings": []
	},
	"servicePrincipalLockConfiguration": {
		"isEnabled": true,
		"allProperties": true,
		"credentialsWithUsageVerify": null,
		"credentialsWithUsageSign": null,
		"identifierUris": null,
		"tokenEncryptionKeyId": null
	},
	"spa": {
		"redirectUris": []
	}
}
```