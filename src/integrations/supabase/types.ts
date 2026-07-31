export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          organization_id: string
          staff_id: string | null
          token_hash: string
          token_type: Database["public"]["Enums"]["token_type"]
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id: string
          staff_id?: string | null
          token_hash: string
          token_type: Database["public"]["Enums"]["token_type"]
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          staff_id?: string | null
          token_hash?: string
          token_type?: Database["public"]["Enums"]["token_type"]
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_tokens_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_impersonations: {
        Row: {
          admin_user_id: string
          ended_at: string | null
          id: string
          organization_id: string
          reason: string | null
          started_at: string
          target_staff_id: string
          target_user_id: string | null
        }
        Insert: {
          admin_user_id: string
          ended_at?: string | null
          id?: string
          organization_id: string
          reason?: string | null
          started_at?: string
          target_staff_id: string
          target_user_id?: string | null
        }
        Update: {
          admin_user_id?: string
          ended_at?: string | null
          id?: string
          organization_id?: string
          reason?: string | null
          started_at?: string
          target_staff_id?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_impersonations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_impersonations_target_staff_id_fkey"
            columns: ["target_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      article_locations: {
        Row: {
          article_id: string
          created_at: string
          id: string
          location_id: string
          organization_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          location_id: string
          organization_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          location_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_locations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      article_taxonomy: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_taxonomy_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          allow_decimal_order_quantity: boolean
          category: string | null
          content_quantity: number | null
          content_unit: string | null
          created_at: string
          description: string | null
          food_pairings: string | null
          grape_variety: string | null
          id: string
          image_url: string | null
          inventory_unit: string
          is_active: boolean
          min_order_quantity: number
          name: string
          order_to_inventory_factor: number
          order_unit: string
          organization_id: string
          origin_country: string | null
          packaging_unit: number | null
          price_cents: number
          quantity_step: number
          reviewed_at: string | null
          reviewed_by_staff_id: string | null
          sku: string | null
          sort_order: number
          special_attributes: string[] | null
          supplier_id: string
          target_stock_bar: number | null
          target_stock_total: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          allow_decimal_order_quantity?: boolean
          category?: string | null
          content_quantity?: number | null
          content_unit?: string | null
          created_at?: string
          description?: string | null
          food_pairings?: string | null
          grape_variety?: string | null
          id?: string
          image_url?: string | null
          inventory_unit?: string
          is_active?: boolean
          min_order_quantity?: number
          name: string
          order_to_inventory_factor?: number
          order_unit?: string
          organization_id: string
          origin_country?: string | null
          packaging_unit?: number | null
          price_cents?: number
          quantity_step?: number
          reviewed_at?: string | null
          reviewed_by_staff_id?: string | null
          sku?: string | null
          sort_order?: number
          special_attributes?: string[] | null
          supplier_id: string
          target_stock_bar?: number | null
          target_stock_total?: number | null
          unit?: string
          updated_at?: string
        }
        Update: {
          allow_decimal_order_quantity?: boolean
          category?: string | null
          content_quantity?: number | null
          content_unit?: string | null
          created_at?: string
          description?: string | null
          food_pairings?: string | null
          grape_variety?: string | null
          id?: string
          image_url?: string | null
          inventory_unit?: string
          is_active?: boolean
          min_order_quantity?: number
          name?: string
          order_to_inventory_factor?: number
          order_unit?: string
          organization_id?: string
          origin_country?: string | null
          packaging_unit?: number | null
          price_cents?: number
          quantity_step?: number
          reviewed_at?: string | null
          reviewed_by_staff_id?: string | null
          sku?: string | null
          sort_order?: number
          special_attributes?: string[] | null
          supplier_id?: string
          target_stock_bar?: number | null
          target_stock_total?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_reviewed_by_staff_id_fkey"
            columns: ["reviewed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_staff_id: string | null
          actor_user_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          meta: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_staff_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          meta?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_staff_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          meta?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          created_at: string
          gocardless_account_id: string | null
          gocardless_agreement_expires_at: string | null
          gocardless_institution_id: string | null
          gocardless_requisition_id: string | null
          iban: string
          id: string
          location_id: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gocardless_account_id?: string | null
          gocardless_agreement_expires_at?: string | null
          gocardless_institution_id?: string | null
          gocardless_requisition_id?: string | null
          iban: string
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gocardless_account_id?: string | null
          gocardless_agreement_expires_at?: string | null
          gocardless_institution_id?: string | null
          gocardless_requisition_id?: string | null
          iban?: string
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_category_rules: {
        Row: {
          category_id: string
          created_at: string
          id: string
          match_field: string
          organization_id: string
          pattern: string
          priority: number
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          match_field: string
          organization_id: string
          pattern: string
          priority?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          match_field?: string
          organization_id?: string
          pattern?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_category_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "bank_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_category_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account_id: string
          bank_kategorie: string
          bank_unterkategorie: string
          betrag_cents: number
          buchungstag: string
          created_at: string
          external_tx_id: string | null
          gegenpartei: string
          id: string
          laufende_nummer: number | null
          organization_id: string
          override_category_id: string | null
          saldo_cents: number | null
          updated_at: string
          verwendungszweck: string
          wertstellungstag: string | null
        }
        Insert: {
          account_id: string
          bank_kategorie?: string
          bank_unterkategorie?: string
          betrag_cents: number
          buchungstag: string
          created_at?: string
          external_tx_id?: string | null
          gegenpartei?: string
          id?: string
          laufende_nummer?: number | null
          organization_id: string
          override_category_id?: string | null
          saldo_cents?: number | null
          updated_at?: string
          verwendungszweck?: string
          wertstellungstag?: string | null
        }
        Update: {
          account_id?: string
          bank_kategorie?: string
          bank_unterkategorie?: string
          betrag_cents?: number
          buchungstag?: string
          created_at?: string
          external_tx_id?: string | null
          gegenpartei?: string
          id?: string
          laufende_nummer?: number | null
          organization_id?: string
          override_category_id?: string | null
          saldo_cents?: number | null
          updated_at?: string
          verwendungszweck?: string
          wertstellungstag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_override_category_id_fkey"
            columns: ["override_category_id"]
            isOneToOne: false
            referencedRelation: "bank_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      bilanz_konten: {
        Row: {
          betrag_cents: number
          created_at: string
          entity: string
          fiscal_year: number
          id: string
          konto_nr: string
          label: string
          organization_id: string
          position_code: string
          sort_order: number
          statement: string
          vorjahr_cents: number | null
        }
        Insert: {
          betrag_cents: number
          created_at?: string
          entity: string
          fiscal_year: number
          id?: string
          konto_nr: string
          label: string
          organization_id: string
          position_code: string
          sort_order: number
          statement: string
          vorjahr_cents?: number | null
        }
        Update: {
          betrag_cents?: number
          created_at?: string
          entity?: string
          fiscal_year?: number
          id?: string
          konto_nr?: string
          label?: string
          organization_id?: string
          position_code?: string
          sort_order?: number
          statement?: string
          vorjahr_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bilanz_konten_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bilanz_positions: {
        Row: {
          betrag_cents: number
          code: string
          created_at: string
          entity: string
          fiscal_year: number
          id: string
          label: string
          level: number
          organization_id: string
          parent_code: string | null
          sort_order: number
          source: string
          statement: string
          updated_at: string
          vorjahr_cents: number | null
        }
        Insert: {
          betrag_cents: number
          code: string
          created_at?: string
          entity: string
          fiscal_year: number
          id?: string
          label: string
          level: number
          organization_id: string
          parent_code?: string | null
          sort_order: number
          source?: string
          statement: string
          updated_at?: string
          vorjahr_cents?: number | null
        }
        Update: {
          betrag_cents?: number
          code?: string
          created_at?: string
          entity?: string
          fiscal_year?: number
          id?: string
          label?: string
          level?: number
          organization_id?: string
          parent_code?: string | null
          sort_order?: number
          source?: string
          statement?: string
          updated_at?: string
          vorjahr_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bilanz_positions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bwa_monthly: {
        Row: {
          abschreibung_cents: number
          anlage_cents: number
          betriebsergebnis_cents: number
          cost_center: string
          created_at: string
          entity: string
          getraenke_cents: number
          id: string
          month: string
          organization_id: string
          personal_cents: number
          sachkosten_cents: number
          sachkosten_detail: Json | null
          sonst_ertraege_cents: number
          sonstige_erloese_cents: number
          source: string
          speisen_ausser_haus_cents: number
          speisen_haus_cents: number
          umsatz_cents: number
          updated_at: string
          wareneinsatz_cents: number
        }
        Insert: {
          abschreibung_cents?: number
          anlage_cents?: number
          betriebsergebnis_cents: number
          cost_center: string
          created_at?: string
          entity: string
          getraenke_cents?: number
          id?: string
          month: string
          organization_id: string
          personal_cents: number
          sachkosten_cents: number
          sachkosten_detail?: Json | null
          sonst_ertraege_cents?: number
          sonstige_erloese_cents?: number
          source?: string
          speisen_ausser_haus_cents?: number
          speisen_haus_cents?: number
          umsatz_cents: number
          updated_at?: string
          wareneinsatz_cents: number
        }
        Update: {
          abschreibung_cents?: number
          anlage_cents?: number
          betriebsergebnis_cents?: number
          cost_center?: string
          created_at?: string
          entity?: string
          getraenke_cents?: number
          id?: string
          month?: string
          organization_id?: string
          personal_cents?: number
          sachkosten_cents?: number
          sachkosten_detail?: Json | null
          sonst_ertraege_cents?: number
          sonstige_erloese_cents?: number
          source?: string
          speisen_ausser_haus_cents?: number
          speisen_haus_cents?: number
          umsatz_cents?: number
          updated_at?: string
          wareneinsatz_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "bwa_monthly_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_draft_items: {
        Row: {
          article_id: string | null
          created_at: string
          draft_id: string
          free_text_name: string | null
          free_text_unit: string | null
          id: string
          is_free_text_item: boolean
          organization_id: string
          quantity: number
          supplier_id: string | null
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          draft_id: string
          free_text_name?: string | null
          free_text_unit?: string | null
          id?: string
          is_free_text_item?: boolean
          organization_id: string
          quantity?: number
          supplier_id?: string | null
        }
        Update: {
          article_id?: string | null
          created_at?: string
          draft_id?: string
          free_text_name?: string | null
          free_text_unit?: string | null
          id?: string
          is_free_text_item?: boolean
          organization_id?: string
          quantity?: number
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_draft_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_draft_items_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "cart_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_draft_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_draft_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_drafts: {
        Row: {
          created_at: string
          delivery_address: string | null
          desired_delivery_date: string | null
          desired_time_window: string | null
          id: string
          location_id: string | null
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delivery_address?: string | null
          desired_delivery_date?: string | null
          desired_time_window?: string | null
          id?: string
          location_id?: string | null
          name?: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          delivery_address?: string | null
          desired_delivery_date?: string | null
          desired_time_window?: string | null
          id?: string
          location_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_drafts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          article_id: string | null
          cart_id: string
          created_at: string
          free_text_name: string | null
          free_text_unit: string | null
          id: string
          is_free_text_item: boolean
          organization_id: string
          quantity: number
          supplier_id: string | null
        }
        Insert: {
          article_id?: string | null
          cart_id: string
          created_at?: string
          free_text_name?: string | null
          free_text_unit?: string | null
          id?: string
          is_free_text_item?: boolean
          organization_id: string
          quantity?: number
          supplier_id?: string | null
        }
        Update: {
          article_id?: string | null
          cart_id?: string
          created_at?: string
          free_text_name?: string | null
          free_text_unit?: string | null
          id?: string
          is_free_text_item?: boolean
          organization_id?: string
          quantity?: number
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          delivery_date: string | null
          id: string
          location_id: string | null
          organization_id: string
          time_window: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delivery_date?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          time_window?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          delivery_date?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          time_window?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_locks: {
        Row: {
          location_id: string
          locked_through_date: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          location_id: string
          locked_through_date: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          location_id?: string
          locked_through_date?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_locks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_locks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_locks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      day_off_wishes: {
        Row: {
          created_at: string
          id: string
          note: string | null
          organization_id: string
          staff_id: string
          wish_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          staff_id: string
          wish_date: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          staff_id?: string
          wish_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_off_wishes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_off_wishes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      display_reminders: {
        Row: {
          anchor_date: string | null
          color: string
          created_at: string
          emoji: string | null
          from_time: string
          id: string
          interval_weeks: number
          is_active: boolean
          location_id: string
          organization_id: string
          sort_order: number
          title: string
          until_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          anchor_date?: string | null
          color: string
          created_at?: string
          emoji?: string | null
          from_time: string
          id?: string
          interval_weeks?: number
          is_active?: boolean
          location_id: string
          organization_id: string
          sort_order?: number
          title: string
          until_time?: string
          updated_at?: string
          weekday: number
        }
        Update: {
          anchor_date?: string | null
          color?: string
          created_at?: string
          emoji?: string | null
          from_time?: string
          id?: string
          interval_weeks?: number
          is_active?: boolean
          location_id?: string
          organization_id?: string
          sort_order?: number
          title?: string
          until_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "display_reminders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "display_reminders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      display_settings: {
        Row: {
          created_at: string
          custom_message: string | null
          display_token_hash: string
          id: string
          is_enabled: boolean
          location_id: string
          organization_id: string
          refresh_interval_seconds: number
          rotation_enabled: boolean
          rotation_interval_seconds: number
          show_areas: string[] | null
          show_footer: boolean
          show_header: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_message?: string | null
          display_token_hash: string
          id?: string
          is_enabled?: boolean
          location_id: string
          organization_id: string
          refresh_interval_seconds?: number
          rotation_enabled?: boolean
          rotation_interval_seconds?: number
          show_areas?: string[] | null
          show_footer?: boolean
          show_header?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_message?: string | null
          display_token_hash?: string
          id?: string
          is_enabled?: boolean
          location_id?: string
          organization_id?: string
          refresh_interval_seconds?: number
          rotation_enabled?: boolean
          rotation_interval_seconds?: number
          show_areas?: string[] | null
          show_footer?: boolean
          show_header?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "display_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "display_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          content: string
          created_at: string
          doc_type: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          doc_type: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          doc_type?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          content: string
          created_at: string
          created_by: string
          doc_type: string
          id: string
          metadata: Json
          organization_id: string
          staff_id: string
          template_id: string | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          doc_type: string
          id?: string
          metadata?: Json
          organization_id: string
          staff_id: string
          template_id?: string | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          doc_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
          staff_id?: string
          template_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          counters: Json
          created_at: string
          created_by: string | null
          file_hash: string
          finished_at: string | null
          id: string
          mode: string
          organization_id: string
          source_system: string
          started_at: string
        }
        Insert: {
          counters?: Json
          created_at?: string
          created_by?: string | null
          file_hash: string
          finished_at?: string | null
          id?: string
          mode: string
          organization_id: string
          source_system: string
          started_at?: string
        }
        Update: {
          counters?: Json
          created_at?: string
          created_by?: string | null
          file_hash?: string
          finished_at?: string | null
          id?: string
          mode?: string
          organization_id?: string
          source_system?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          article_id: string
          article_name_snapshot: string | null
          created_at: string
          id: string
          inventory_unit_snapshot: string | null
          line_value_cents: number
          normalized_price_per_inventory_unit_cents: number | null
          order_to_inventory_factor_snapshot: number | null
          order_unit_snapshot: string | null
          organization_id: string
          session_id: string
          storage_1: number
          storage_2: number
          total_qty: number | null
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          article_id: string
          article_name_snapshot?: string | null
          created_at?: string
          id?: string
          inventory_unit_snapshot?: string | null
          line_value_cents?: number
          normalized_price_per_inventory_unit_cents?: number | null
          order_to_inventory_factor_snapshot?: number | null
          order_unit_snapshot?: string | null
          organization_id: string
          session_id: string
          storage_1?: number
          storage_2?: number
          total_qty?: number | null
          unit_price_cents?: number
          updated_at?: string
        }
        Update: {
          article_id?: string
          article_name_snapshot?: string | null
          created_at?: string
          id?: string
          inventory_unit_snapshot?: string | null
          line_value_cents?: number
          normalized_price_per_inventory_unit_cents?: number | null
          order_to_inventory_factor_snapshot?: number | null
          order_unit_snapshot?: string | null
          organization_id?: string
          session_id?: string
          storage_1?: number
          storage_2?: number
          total_qty?: number | null
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          location_id: string
          name: string
          notes: string | null
          organization_id: string
          status: string
          total_value_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          location_id: string
          name?: string
          notes?: string | null
          organization_id: string
          status?: string
          total_value_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          location_id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          status?: string
          total_value_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ki_usage_log: {
        Row: {
          cost_microcents: number
          created_at: string
          id: string
          input_tokens: number
          model: string
          organization_id: string
          output_tokens: number
          staff_id: string | null
          tool_rounds: number
        }
        Insert: {
          cost_microcents?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model: string
          organization_id: string
          output_tokens?: number
          staff_id?: string | null
          tool_rounds?: number
        }
        Update: {
          cost_microcents?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          organization_id?: string
          output_tokens?: number
          staff_id?: string | null
          tool_rounds?: number
        }
        Relationships: [
          {
            foreignKeyName: "ki_usage_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ki_usage_log_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_staff_id: string | null
          decision_note: string | null
          end_date: string
          id: string
          organization_id: string
          reason: string | null
          staff_id: string
          start_date: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_staff_id?: string | null
          decision_note?: string | null
          end_date: string
          id?: string
          organization_id: string
          reason?: string | null
          staff_id: string
          start_date: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_staff_id?: string | null
          decision_note?: string | null
          end_date?: string
          id?: string
          organization_id?: string
          reason?: string | null
          staff_id?: string
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_decided_by_staff_id_fkey"
            columns: ["decided_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      location_calendar_exceptions: {
        Row: {
          created_at: string
          date: string
          id: string
          kind: string
          location_id: string
          organization_id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          kind: string
          location_id: string
          organization_id: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          kind?: string
          location_id?: string
          organization_id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_calendar_exceptions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_calendar_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_department_defaults: {
        Row: {
          created_at: string
          default_checkin: string
          default_checkin_sunday_holiday: string | null
          default_checkout: string | null
          default_checkout_sunday_holiday: string | null
          department: Database["public"]["Enums"]["staff_department"]
          id: string
          location_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_checkin: string
          default_checkin_sunday_holiday?: string | null
          default_checkout?: string | null
          default_checkout_sunday_holiday?: string | null
          department: Database["public"]["Enums"]["staff_department"]
          id?: string
          location_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_checkin?: string
          default_checkin_sunday_holiday?: string | null
          default_checkout?: string | null
          default_checkout_sunday_holiday?: string | null
          department?: Database["public"]["Enums"]["staff_department"]
          id?: string
          location_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_department_defaults_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_department_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_rest_days: {
        Row: {
          created_at: string
          id: string
          location_id: string
          organization_id: string
          weekday: number
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          organization_id: string
          weekday: number
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          organization_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "location_rest_days_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_rest_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          cash_balance_target_cents: number | null
          city: string | null
          commission_enabled: boolean
          commission_min_revenue_cents: number
          commission_pct: number
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          delivery_notes: string | null
          enabled_service_periods: string[]
          geocoded_address: string | null
          geocoded_at: string | null
          geofence_radius_m: number
          id: string
          is_active: boolean
          kitchen_manual_only_override: boolean | null
          kitchen_tip_rate_override: number | null
          latitude: number | null
          longitude: number | null
          name: string
          organization_id: string
          phone: string | null
          postal_code: string | null
          street: string | null
          timezone: string
          tip_distribution_mode_from_override: string | null
          tip_distribution_mode_override: string | null
          tip_pool_min_hours_override: number | null
          tip_service_pool_enabled: boolean
          updated_at: string
        }
        Insert: {
          cash_balance_target_cents?: number | null
          city?: string | null
          commission_enabled?: boolean
          commission_min_revenue_cents?: number
          commission_pct?: number
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery_notes?: string | null
          enabled_service_periods?: string[]
          geocoded_address?: string | null
          geocoded_at?: string | null
          geofence_radius_m?: number
          id?: string
          is_active?: boolean
          kitchen_manual_only_override?: boolean | null
          kitchen_tip_rate_override?: number | null
          latitude?: number | null
          longitude?: number | null
          name: string
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          street?: string | null
          timezone?: string
          tip_distribution_mode_from_override?: string | null
          tip_distribution_mode_override?: string | null
          tip_pool_min_hours_override?: number | null
          tip_service_pool_enabled?: boolean
          updated_at?: string
        }
        Update: {
          cash_balance_target_cents?: number | null
          city?: string | null
          commission_enabled?: boolean
          commission_min_revenue_cents?: number
          commission_pct?: number
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery_notes?: string | null
          enabled_service_periods?: string[]
          geocoded_address?: string | null
          geocoded_at?: string | null
          geofence_radius_m?: number
          id?: string
          is_active?: boolean
          kitchen_manual_only_override?: boolean | null
          kitchen_tip_rate_override?: number | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          street?: string | null
          timezone?: string
          tip_distribution_mode_from_override?: string | null
          tip_distribution_mode_override?: string | null
          tip_pool_min_hours_override?: number | null
          tip_service_pool_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lohn_absence_days: {
        Row: {
          created_at: string
          krank_tage: number
          organization_id: string
          period_start: string
          staff_id: string
          updated_at: string
          urlaub_tage: number
        }
        Insert: {
          created_at?: string
          krank_tage?: number
          organization_id: string
          period_start: string
          staff_id: string
          updated_at?: string
          urlaub_tage?: number
        }
        Update: {
          created_at?: string
          krank_tage?: number
          organization_id?: string
          period_start?: string
          staff_id?: string
          updated_at?: string
          urlaub_tage?: number
        }
        Relationships: [
          {
            foreignKeyName: "lohn_absence_days_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lohn_absence_days_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      lohn_recurring_zeilen: {
        Row: {
          betrag_cent: number
          bezeichnung: string
          created_at: string
          id: string
          kategorie: string
          organization_id: string
          sort_order: number
          staff_id: string
          updated_at: string
        }
        Insert: {
          betrag_cent: number
          bezeichnung: string
          created_at?: string
          id?: string
          kategorie: string
          organization_id: string
          sort_order?: number
          staff_id: string
          updated_at?: string
        }
        Update: {
          betrag_cent?: number
          bezeichnung?: string
          created_at?: string
          id?: string
          kategorie?: string
          organization_id?: string
          sort_order?: number
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lohn_recurring_zeilen_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lohn_recurring_zeilen_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_email_log: {
        Row: {
          created_at: string
          error_message: string | null
          http_status: number | null
          id: string
          is_resend: boolean
          mode: string
          order_id: string
          organization_id: string
          provider_message_id: string | null
          recipient_email: string
          response_body: string | null
          sent_at: string
          status: string
          subject: string
          supplier_email_snapshot: string | null
          triggered_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          is_resend?: boolean
          mode: string
          order_id: string
          organization_id: string
          provider_message_id?: string | null
          recipient_email: string
          response_body?: string | null
          sent_at?: string
          status: string
          subject: string
          supplier_email_snapshot?: string | null
          triggered_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          http_status?: number | null
          id?: string
          is_resend?: boolean
          mode?: string
          order_id?: string
          organization_id?: string
          provider_message_id?: string | null
          recipient_email?: string
          response_body?: string | null
          sent_at?: string
          status?: string
          subject?: string
          supplier_email_snapshot?: string | null
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_email_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          article_id: string | null
          article_name: string
          created_at: string
          id: string
          inventory_unit_snapshot: string | null
          is_free_text_item: boolean
          normalized_price_per_inventory_unit_cents: number | null
          order_id: string
          order_to_inventory_factor_snapshot: number | null
          organization_id: string
          quantity: number
          sku: string | null
          total_price_cents: number
          unit: string
          unit_price_cents: number
        }
        Insert: {
          article_id?: string | null
          article_name: string
          created_at?: string
          id?: string
          inventory_unit_snapshot?: string | null
          is_free_text_item?: boolean
          normalized_price_per_inventory_unit_cents?: number | null
          order_id: string
          order_to_inventory_factor_snapshot?: number | null
          organization_id: string
          quantity: number
          sku?: string | null
          total_price_cents?: number
          unit?: string
          unit_price_cents?: number
        }
        Update: {
          article_id?: string | null
          article_name?: string
          created_at?: string
          id?: string
          inventory_unit_snapshot?: string | null
          is_free_text_item?: boolean
          normalized_price_per_inventory_unit_cents?: number | null
          order_id?: string
          order_to_inventory_factor_snapshot?: number | null
          organization_id?: string
          quantity?: number
          sku?: string | null
          total_price_cents?: number
          unit?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_replies: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          body_text: string | null
          created_at: string
          from_email: string
          from_name: string | null
          id: string
          message_id: string | null
          order_id: string | null
          organization_id: string
          read_at: string | null
          received_at: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          body_text?: string | null
          created_at?: string
          from_email: string
          from_name?: string | null
          id?: string
          message_id?: string | null
          order_id?: string | null
          organization_id: string
          read_at?: string | null
          received_at?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          body_text?: string | null
          created_at?: string
          from_email?: string
          from_name?: string | null
          id?: string
          message_id?: string | null
          order_id?: string | null
          organization_id?: string
          read_at?: string | null
          received_at?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_replies_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_replies_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_reply_attachments: {
        Row: {
          content_type: string
          created_at: string
          file_name: string
          id: string
          organization_id: string
          reply_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          content_type: string
          created_at?: string
          file_name: string
          id?: string
          organization_id: string
          reply_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          content_type?: string
          created_at?: string
          file_name?: string
          id?: string
          organization_id?: string
          reply_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_reply_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reply_attachments_reply_id_fkey"
            columns: ["reply_id"]
            isOneToOne: false
            referencedRelation: "order_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          confirmation_token: string | null
          confirmed_at: string | null
          created_at: string
          delivery_address: string | null
          delivery_date: string | null
          email_error: string | null
          email_message_id: string | null
          email_sent: boolean
          email_sent_at: string | null
          id: string
          location_id: string | null
          notes: string | null
          order_number: string
          organization_id: string
          status: string
          supplier_id: string
          time_window: string | null
          total_amount_cents: number
          updated_at: string
        }
        Insert: {
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          delivery_address?: string | null
          delivery_date?: string | null
          email_error?: string | null
          email_message_id?: string | null
          email_sent?: boolean
          email_sent_at?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          order_number?: string
          organization_id: string
          status?: string
          supplier_id: string
          time_window?: string | null
          total_amount_cents?: number
          updated_at?: string
        }
        Update: {
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          delivery_address?: string | null
          delivery_date?: string | null
          email_error?: string | null
          email_message_id?: string | null
          email_sent?: boolean
          email_sent_at?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          order_number?: string
          organization_id?: string
          status?: string
          supplier_id?: string
          time_window?: string | null
          total_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          arbeitgeber_adresse: string | null
          arbeitgeber_name: string | null
          arbeitgeber_vertreter: string | null
          batch_sunhol_end: string
          batch_sunhol_start: string
          batch_weekday_end: string
          batch_weekday_start: string
          betriebsnummer: string | null
          count_holidays_as_leave: boolean
          created_at: string
          kitchen_manual_only: boolean
          kitchen_tip_rate: number
          order_email_bcc: string | null
          order_email_reply_to: string | null
          order_reply_forward_unassigned: boolean
          order_reply_telegram_enabled: boolean
          organization_id: string
          pausen_bezahlt: boolean
          telegram_bot_username: string | null
          telegram_report_enabled: boolean
          telegram_report_flags: Json
          telegram_report_hour: number
          telegram_report_last_sent: string | null
          test_mode_email: string | null
          test_mode_enabled: boolean
          time_locked_through_date: string | null
          tip_distribution_mode: string
          tip_distribution_mode_from: string | null
          tip_pool_min_hours: number
          updated_at: string
        }
        Insert: {
          arbeitgeber_adresse?: string | null
          arbeitgeber_name?: string | null
          arbeitgeber_vertreter?: string | null
          batch_sunhol_end?: string
          batch_sunhol_start?: string
          batch_weekday_end?: string
          batch_weekday_start?: string
          betriebsnummer?: string | null
          count_holidays_as_leave?: boolean
          created_at?: string
          kitchen_manual_only?: boolean
          kitchen_tip_rate?: number
          order_email_bcc?: string | null
          order_email_reply_to?: string | null
          order_reply_forward_unassigned?: boolean
          order_reply_telegram_enabled?: boolean
          organization_id: string
          pausen_bezahlt?: boolean
          telegram_bot_username?: string | null
          telegram_report_enabled?: boolean
          telegram_report_flags?: Json
          telegram_report_hour?: number
          telegram_report_last_sent?: string | null
          test_mode_email?: string | null
          test_mode_enabled?: boolean
          time_locked_through_date?: string | null
          tip_distribution_mode?: string
          tip_distribution_mode_from?: string | null
          tip_pool_min_hours?: number
          updated_at?: string
        }
        Update: {
          arbeitgeber_adresse?: string | null
          arbeitgeber_name?: string | null
          arbeitgeber_vertreter?: string | null
          batch_sunhol_end?: string
          batch_sunhol_start?: string
          batch_weekday_end?: string
          batch_weekday_start?: string
          betriebsnummer?: string | null
          count_holidays_as_leave?: boolean
          created_at?: string
          kitchen_manual_only?: boolean
          kitchen_tip_rate?: number
          order_email_bcc?: string | null
          order_email_reply_to?: string | null
          order_reply_forward_unassigned?: boolean
          order_reply_telegram_enabled?: boolean
          organization_id?: string
          pausen_bezahlt?: boolean
          telegram_bot_username?: string | null
          telegram_report_enabled?: boolean
          telegram_report_flags?: Json
          telegram_report_hour?: number
          telegram_report_last_sent?: string | null
          test_mode_email?: string | null
          test_mode_enabled?: boolean
          time_locked_through_date?: string | null
          tip_distribution_mode?: string
          tip_distribution_mode_from?: string | null
          tip_pool_min_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          cash_balance_target_cents: number
          created_at: string
          id: string
          name: string
          opening_safe_balance_cents: number
          trmnl_token_hash: string | null
          updated_at: string
        }
        Insert: {
          cash_balance_target_cents?: number
          created_at?: string
          id?: string
          name: string
          opening_safe_balance_cents?: number
          trmnl_token_hash?: string | null
          updated_at?: string
        }
        Update: {
          cash_balance_target_cents?: number
          created_at?: string
          id?: string
          name?: string
          opening_safe_balance_cents?: number
          trmnl_token_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_terminals: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_gl: boolean
          label: string
          location_id: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_gl?: boolean
          label: string
          location_id: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_gl?: boolean
          label?: string
          location_id?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_terminals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_terminals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_notes: {
        Row: {
          besonderheiten: string | null
          created_at: string
          id: string
          location_id: string
          organization_id: string
          period_end: string
          period_start: string
          staff_id: string
          updated_at: string
          vorschuss: number
        }
        Insert: {
          besonderheiten?: string | null
          created_at?: string
          id?: string
          location_id: string
          organization_id: string
          period_end: string
          period_start: string
          staff_id: string
          updated_at?: string
          vorschuss?: number
        }
        Update: {
          besonderheiten?: string | null
          created_at?: string
          id?: string
          location_id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          staff_id?: string
          updated_at?: string
          vorschuss?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_notes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_notes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_recurring_notes: {
        Row: {
          canceled_at: string | null
          created_at: string
          created_by_staff_id: string | null
          first_period_start: string
          id: string
          kind: string
          location_id: string | null
          organization_id: string
          periods_total: number | null
          staff_id: string
          text: string
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          created_by_staff_id?: string | null
          first_period_start: string
          id?: string
          kind: string
          location_id?: string | null
          organization_id: string
          periods_total?: number | null
          staff_id: string
          text: string
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          created_by_staff_id?: string | null
          first_period_start?: string
          id?: string
          kind?: string
          location_id?: string | null
          organization_id?: string
          periods_total?: number | null
          staff_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_recurring_notes_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_recurring_notes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_recurring_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_recurring_notes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      periods: {
        Row: {
          created_at: string
          end_date: string
          id: string
          label: string
          organization_id: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          label: string
          organization_id: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          label?: string
          organization_id?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_overrides: {
        Row: {
          area: Database["public"]["Enums"]["staff_department"] | null
          created_at: string
          created_by: string | null
          effect: Database["public"]["Enums"]["permission_effect"]
          id: string
          location_id: string | null
          organization_id: string
          permission: Database["public"]["Enums"]["app_permission"]
          staff_id: string
          updated_at: string
        }
        Insert: {
          area?: Database["public"]["Enums"]["staff_department"] | null
          created_at?: string
          created_by?: string | null
          effect: Database["public"]["Enums"]["permission_effect"]
          id?: string
          location_id?: string | null
          organization_id: string
          permission: Database["public"]["Enums"]["app_permission"]
          staff_id: string
          updated_at?: string
        }
        Update: {
          area?: Database["public"]["Enums"]["staff_department"] | null
          created_at?: string
          created_by?: string | null
          effect?: Database["public"]["Enums"]["permission_effect"]
          id?: string
          location_id?: string | null
          organization_id?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_overrides_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_overrides_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_role_defaults: {
        Row: {
          created_at: string
          permission: Database["public"]["Enums"]["app_permission"]
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          permission: Database["public"]["Enums"]["app_permission"]
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      pin_attempts: {
        Row: {
          attempted_at: string
          id: string
          ip: string | null
          organization_id: string
          staff_id: string
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip?: string | null
          organization_id: string
          staff_id: string
        }
        Update: {
          attempted_at?: string
          id?: string
          ip?: string | null
          organization_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pin_attempts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_hourly_stats: {
        Row: {
          anzahl: number
          created_at: string
          hour: number
          id: string
          location_id: string
          organization_id: string
          period: string
          report_date: string
          wert_cents: number
        }
        Insert: {
          anzahl?: number
          created_at?: string
          hour: number
          id?: string
          location_id: string
          organization_id: string
          period: string
          report_date: string
          wert_cents?: number
        }
        Update: {
          anzahl?: number
          created_at?: string
          hour?: number
          id?: string
          location_id?: string
          organization_id?: string
          period?: string
          report_date?: string
          wert_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_hourly_stats_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_hourly_stats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_items: {
        Row: {
          article_id: string | null
          id: string
          loss_percent: number
          position: number
          quantity: number
          recipe_id: string
          sub_recipe_id: string | null
          unit: string
        }
        Insert: {
          article_id?: string | null
          id?: string
          loss_percent?: number
          position?: number
          quantity: number
          recipe_id: string
          sub_recipe_id?: string | null
          unit: string
        }
        Update: {
          article_id?: string | null
          id?: string
          loss_percent?: number
          position?: number
          quantity?: number
          recipe_id?: string
          sub_recipe_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_sub_recipe_id_fkey"
            columns: ["sub_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
          yield_quantity: number | null
          yield_unit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          yield_quantity?: number | null
          yield_unit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          yield_quantity?: number | null
          yield_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_channels: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_takeaway: boolean
          kind: string
          label: string
          location_id: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_takeaway?: boolean
          kind: string
          label: string
          location_id: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_takeaway?: boolean
          kind?: string
          label?: string
          location_id?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_channels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_assignments: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_absence: {
        Row: {
          created_at: string
          date: string
          id: string
          organization_id: string
          staff_id: string
          type: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          organization_id: string
          staff_id: string
          type?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          organization_id?: string
          staff_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_absence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_absence_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_availability: {
        Row: {
          created_at: string
          date: string
          id: string
          organization_id: string
          staff_id: string
          type: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          organization_id: string
          staff_id: string
          type?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          organization_id?: string
          staff_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_availability_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_availability_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_releases: {
        Row: {
          area: string
          id: string
          location_id: string
          organization_id: string
          period_id: string
          released_at: string
          released_by: string | null
        }
        Insert: {
          area: string
          id?: string
          location_id: string
          organization_id: string
          period_id: string
          released_at?: string
          released_by?: string | null
        }
        Update: {
          area?: string
          id?: string
          location_id?: string
          organization_id?: string
          period_id?: string
          released_at?: string
          released_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_releases_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_releases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_releases_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_releases_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_shifts: {
        Row: {
          area: Database["public"]["Enums"]["staff_department"]
          created_at: string
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          service_period: string
          shift_date: string
          skill_id: string | null
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          area: Database["public"]["Enums"]["staff_department"]
          created_at?: string
          id?: string
          location_id: string
          notes?: string | null
          organization_id: string
          service_period?: string
          shift_date: string
          skill_id?: string | null
          staff_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          area?: Database["public"]["Enums"]["staff_department"]
          created_at?: string
          id?: string
          location_id?: string
          notes?: string | null
          organization_id?: string
          service_period?: string
          shift_date?: string
          skill_id?: string | null
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_shifts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_article_stats: {
        Row: {
          created_at: string
          id: string
          location_id: string
          name: string
          nummer: number
          organization_id: string
          period: string
          report_date: string
          umsatz_cents: number
          verkauf_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          name: string
          nummer: number
          organization_id: string
          period: string
          report_date: string
          umsatz_cents?: number
          verkauf_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          name?: string
          nummer?: number
          organization_id?: string
          period?: string
          report_date?: string
          umsatz_cents?: number
          verkauf_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_article_stats_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_article_stats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_articles: {
        Row: {
          created_at: string
          ek_match_ignored: boolean
          ek_portion_ml: number | null
          ek_price_cents: number | null
          ek_source_article_id: string | null
          ek_source_volume_ml: number | null
          hauptgruppe: string | null
          hauptgruppe_nr: number | null
          id: string
          is_active: boolean
          location_id: string
          name: string
          organization_id: string
          price_cents: number | null
          product_group: number | null
          recipe_id: string | null
          takeaway_price_cents: number | null
          untergruppe: string | null
          untergruppe_nr: number | null
          updated_at: string
          warengruppe: string | null
        }
        Insert: {
          created_at?: string
          ek_match_ignored?: boolean
          ek_portion_ml?: number | null
          ek_price_cents?: number | null
          ek_source_article_id?: string | null
          ek_source_volume_ml?: number | null
          hauptgruppe?: string | null
          hauptgruppe_nr?: number | null
          id?: string
          is_active?: boolean
          location_id: string
          name: string
          organization_id: string
          price_cents?: number | null
          product_group?: number | null
          recipe_id?: string | null
          takeaway_price_cents?: number | null
          untergruppe?: string | null
          untergruppe_nr?: number | null
          updated_at?: string
          warengruppe?: string | null
        }
        Update: {
          created_at?: string
          ek_match_ignored?: boolean
          ek_portion_ml?: number | null
          ek_price_cents?: number | null
          ek_source_article_id?: string | null
          ek_source_volume_ml?: number | null
          hauptgruppe?: string | null
          hauptgruppe_nr?: number | null
          id?: string
          is_active?: boolean
          location_id?: string
          name?: string
          organization_id?: string
          price_cents?: number | null
          product_group?: number | null
          recipe_id?: string | null
          takeaway_price_cents?: number | null
          untergruppe?: string | null
          untergruppe_nr?: number | null
          updated_at?: string
          warengruppe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_articles_ek_source_article_id_fkey"
            columns: ["ek_source_article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_articles_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_articles_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_pos_group_overrides: {
        Row: {
          created_at: string
          hauptgruppe: string | null
          hauptgruppe_nr: number | null
          id: string
          location_id: string
          nummer: number
          organization_id: string
          product_group: number | null
          untergruppe: string | null
          untergruppe_nr: number | null
          updated_at: string
          warengruppe: string | null
        }
        Insert: {
          created_at?: string
          hauptgruppe?: string | null
          hauptgruppe_nr?: number | null
          id?: string
          location_id: string
          nummer: number
          organization_id: string
          product_group?: number | null
          untergruppe?: string | null
          untergruppe_nr?: number | null
          updated_at?: string
          warengruppe?: string | null
        }
        Update: {
          created_at?: string
          hauptgruppe?: string | null
          hauptgruppe_nr?: number | null
          id?: string
          location_id?: string
          nummer?: number
          organization_id?: string
          product_group?: number | null
          untergruppe?: string | null
          untergruppe_nr?: number | null
          updated_at?: string
          warengruppe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_pos_group_overrides_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_pos_group_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_advances: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          note: string | null
          organization_id: string
          session_id: string
          staff_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          session_id: string
          staff_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          session_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_advances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_advances_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_advances_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      session_bank_deposits: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          organization_id: string
          reference: string | null
          session_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          organization_id: string
          reference?: string | null
          session_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          organization_id?: string
          reference?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_bank_deposits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_bank_deposits_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_card_transactions: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          note: string | null
          organization_id: string
          session_id: string
          terminal_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          session_id: string
          terminal_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          session_id?: string
          terminal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_card_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_card_transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_card_transactions_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "payment_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      session_channel_amounts: {
        Row: {
          amount_cents: number
          channel_id: string
          created_at: string
          id: string
          organization_id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          channel_id: string
          created_at?: string
          id?: string
          organization_id: string
          session_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          channel_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_channel_amounts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "revenue_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_channel_amounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_channel_amounts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_expenses: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          id: string
          organization_id: string
          session_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          description: string
          id?: string
          organization_id: string
          session_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_expenses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_register_transfers: {
        Row: {
          amount_cents: number
          created_at: string
          direction: Database["public"]["Enums"]["register_transfer_direction"]
          id: string
          note: string | null
          organization_id: string
          session_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          direction: Database["public"]["Enums"]["register_transfer_direction"]
          id?: string
          note?: string | null
          organization_id: string
          session_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["register_transfer_direction"]
          id?: string
          note?: string | null
          organization_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_register_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_register_transfers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_terminal_amounts: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          organization_id: string
          session_id: string
          terminal_id: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          id?: string
          organization_id: string
          session_id: string
          terminal_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          organization_id?: string
          session_id?: string
          terminal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_terminal_amounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_terminal_amounts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_terminal_amounts_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "payment_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      session_tip_pool_entries: {
        Row: {
          created_at: string
          created_by: string | null
          department: Database["public"]["Enums"]["staff_department"]
          hours_minutes: number
          id: string
          note: string | null
          organization_id: string
          participates: boolean | null
          session_id: string
          shift_end: string | null
          shift_start: string | null
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department: Database["public"]["Enums"]["staff_department"]
          hours_minutes: number
          id?: string
          note?: string | null
          organization_id: string
          participates?: boolean | null
          session_id: string
          shift_end?: string | null
          shift_start?: string | null
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department?: Database["public"]["Enums"]["staff_department"]
          hours_minutes?: number
          id?: string
          note?: string | null
          organization_id?: string
          participates?: boolean | null
          session_id?: string
          shift_end?: string | null
          shift_start?: string | null
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_tip_pool_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_tip_pool_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_tip_pool_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          business_date: string
          cash_actual_cents: number | null
          created_at: string
          einladung_cents: number
          finalized_at: string | null
          finalized_by: string | null
          finedine_vouchers_cents: number
          guest_count: number
          id: string
          location_id: string
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          opening_balance_cents: number | null
          opentabs_deduction_cents: number
          organization_id: string
          sonstige_einnahme_cents: number
          status: Database["public"]["Enums"]["session_status"]
          tip_pool_settlement_only: boolean
          updated_at: string
          vectron_daily_total_cents: number
          vorschuss_cents: number
          vouchers_redeemed_cents: number
          vouchers_sold_cents: number
        }
        Insert: {
          business_date: string
          cash_actual_cents?: number | null
          created_at?: string
          einladung_cents?: number
          finalized_at?: string | null
          finalized_by?: string | null
          finedine_vouchers_cents?: number
          guest_count?: number
          id?: string
          location_id: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          opening_balance_cents?: number | null
          opentabs_deduction_cents?: number
          organization_id: string
          sonstige_einnahme_cents?: number
          status?: Database["public"]["Enums"]["session_status"]
          tip_pool_settlement_only?: boolean
          updated_at?: string
          vectron_daily_total_cents?: number
          vorschuss_cents?: number
          vouchers_redeemed_cents?: number
          vouchers_sold_cents?: number
        }
        Update: {
          business_date?: string
          cash_actual_cents?: number | null
          created_at?: string
          einladung_cents?: number
          finalized_at?: string | null
          finalized_by?: string | null
          finedine_vouchers_cents?: number
          guest_count?: number
          id?: string
          location_id?: string
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          opening_balance_cents?: number | null
          opentabs_deduction_cents?: number
          organization_id?: string
          sonstige_einnahme_cents?: number
          status?: Database["public"]["Enums"]["session_status"]
          tip_pool_settlement_only?: boolean
          updated_at?: string
          vectron_daily_total_cents?: number
          vorschuss_cents?: number
          vouchers_redeemed_cents?: number
          vouchers_sold_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "sessions_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_partners: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          settlement_id: string
          staff_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          settlement_id: string
          staff_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          settlement_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_partners_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "waiter_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_partners_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swap_declines: {
        Row: {
          created_at: string
          request_id: string
          staff_id: string
        }
        Insert: {
          created_at?: string
          request_id: string
          staff_id: string
        }
        Update: {
          created_at?: string
          request_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_declines_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "shift_swap_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_declines_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swap_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          organization_id: string
          peer_shift_id: string | null
          peer_staff_id: string | null
          requester_staff_id: string
          responded_at: string | null
          shift_id: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          organization_id: string
          peer_shift_id?: string | null
          peer_staff_id?: string | null
          requester_staff_id: string
          responded_at?: string | null
          shift_id: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          peer_shift_id?: string | null
          peer_staff_id?: string | null
          requester_staff_id?: string
          responded_at?: string | null
          shift_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_peer_shift_id_fkey"
            columns: ["peer_shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_peer_staff_id_fkey"
            columns: ["peer_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requester_staff_id_fkey"
            columns: ["requester_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "roster_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: Database["public"]["Enums"]["skill_category"]
          color: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["skill_category"]
          color?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["skill_category"]
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sofortmeldung: {
        Row: {
          created_at: string
          id: string
          note: string | null
          organization_id: string
          reported_at: string | null
          reported_by: string | null
          required: boolean
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          reported_at?: string | null
          reported_by?: string | null
          required?: boolean
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          reported_at?: string | null
          reported_by?: string | null
          required?: boolean
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sofortmeldung_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sofortmeldung_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sofortmeldung_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          can_easyorder_auto_send: boolean
          contracted_hours_per_month: number | null
          created_at: string
          display_name: string
          email: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          must_change_password: boolean
          organization_id: string
          participates_in_pool: boolean
          perso_nr: number | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          can_easyorder_auto_send?: boolean
          contracted_hours_per_month?: number | null
          created_at?: string
          display_name: string
          email?: string | null
          first_name: string
          id?: string
          is_active?: boolean
          last_name: string
          must_change_password?: boolean
          organization_id: string
          participates_in_pool?: boolean
          perso_nr?: number | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          can_easyorder_auto_send?: boolean
          contracted_hours_per_month?: number | null
          created_at?: string
          display_name?: string
          email?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          must_change_password?: boolean
          organization_id?: string
          participates_in_pool?: boolean
          perso_nr?: number | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_compensation_rates: {
        Row: {
          created_at: string
          department: Database["public"]["Enums"]["staff_department"]
          hourly_rate: number
          id: string
          organization_id: string
          staff_id: string
          updated_at: string
          valid_from: string
        }
        Insert: {
          created_at?: string
          department: Database["public"]["Enums"]["staff_department"]
          hourly_rate: number
          id?: string
          organization_id: string
          staff_id: string
          updated_at?: string
          valid_from: string
        }
        Update: {
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"]
          hourly_rate?: number
          id?: string
          organization_id?: string
          staff_id?: string
          updated_at?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_compensation_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_compensation_rates_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_data_change_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          organization_id: string
          payload: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          payload: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          payload?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_data_change_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_data_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_data_change_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_documents: {
        Row: {
          created_at: string
          doc_type: string
          file_path: string
          id: string
          mime_type: string
          note: string | null
          organization_id: string
          original_filename: string
          size_bytes: number
          staff_id: string
          uploaded_by: string
          valid_until: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type: string
          file_path: string
          id?: string
          mime_type: string
          note?: string | null
          organization_id: string
          original_filename: string
          size_bytes: number
          staff_id: string
          uploaded_by: string
          valid_until?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          file_path?: string
          id?: string
          mime_type?: string
          note?: string | null
          organization_id?: string
          original_filename?: string
          size_bytes?: number
          staff_id?: string
          uploaded_by?: string
          valid_until?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_easyorder_access: {
        Row: {
          can_add_free_items: boolean
          created_at: string
          id: string
          is_active: boolean
          location_id: string
          organization_id: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          can_add_free_items?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          location_id: string
          organization_id: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          can_add_free_items?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string
          organization_id?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_easyorder_access_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_easyorder_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_easyorder_access_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_easyorder_suppliers: {
        Row: {
          created_at: string
          id: string
          location_id: string
          organization_id: string
          staff_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          organization_id: string
          staff_id: string
          supplier_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          organization_id?: string
          staff_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_easyorder_suppliers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_easyorder_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_easyorder_suppliers_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_easyorder_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_edlohn_slots: {
        Row: {
          created_at: string
          department: Database["public"]["Enums"]["staff_department"]
          id: string
          organization_id: string
          slot: number
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department: Database["public"]["Enums"]["staff_department"]
          id?: string
          organization_id: string
          slot: number
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"]
          id?: string
          organization_id?: string
          slot?: number
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_edlohn_slots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_edlohn_slots_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_identity_map: {
        Row: {
          alt_id: string
          alt_name: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          organization_id: string
          source_system: string
          staff_id: string | null
          updated_at: string
        }
        Insert: {
          alt_id: string
          alt_name: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          source_system: string
          staff_id?: string | null
          updated_at?: string
        }
        Update: {
          alt_id?: string
          alt_name?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          source_system?: string
          staff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_identity_map_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_identity_map_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_locations: {
        Row: {
          created_at: string
          department: Database["public"]["Enums"]["staff_department"]
          id: string
          location_id: string
          organization_id: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department: Database["public"]["Enums"]["staff_department"]
          id?: string
          location_id: string
          organization_id: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"]
          id?: string
          location_id?: string
          organization_id?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_locations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_personal_details: {
        Row: {
          account_holder: string | null
          address: string | null
          av_frei: boolean
          bank_name: string | null
          child_tax_allowances: number | null
          children_count: number | null
          church_tax_liable: boolean | null
          city: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          employment_end_date: string | null
          employment_start_date: string | null
          has_parent_status: boolean | null
          health_insurance: string | null
          iban: string | null
          id: string
          is_midijob: boolean
          is_minijob: boolean | null
          is_pkv: boolean
          is_sv_exempt: boolean | null
          ist_werkstudent: boolean
          job_title: string | null
          kk_zusatzbeitrag: number | null
          konfession: string | null
          kv_frei: boolean
          lst_freibetrag_monat_cent: number
          meal_allowance: boolean
          nationality: string | null
          organization_id: string
          personnel_group: string | null
          phone: string | null
          pkv_basis_beitrag_monat_cent: number
          place_of_birth: string | null
          postal_code: string | null
          pv_frei: boolean
          rv_frei: boolean
          sachbezug_monthly_cents: number
          salutation: string | null
          social_security_number: string | null
          soll_hours_per_day: number
          staff_id: string
          street: string | null
          tax_class: string | null
          tax_id: string | null
          updated_at: string
          vacation_days_contractual: number | null
          vacation_days_current_year: number | null
          vacation_days_previous_year: number | null
          vacation_days_taken: number | null
        }
        Insert: {
          account_holder?: string | null
          address?: string | null
          av_frei?: boolean
          bank_name?: string | null
          child_tax_allowances?: number | null
          children_count?: number | null
          church_tax_liable?: boolean | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          employment_end_date?: string | null
          employment_start_date?: string | null
          has_parent_status?: boolean | null
          health_insurance?: string | null
          iban?: string | null
          id?: string
          is_midijob?: boolean
          is_minijob?: boolean | null
          is_pkv?: boolean
          is_sv_exempt?: boolean | null
          ist_werkstudent?: boolean
          job_title?: string | null
          kk_zusatzbeitrag?: number | null
          konfession?: string | null
          kv_frei?: boolean
          lst_freibetrag_monat_cent?: number
          meal_allowance?: boolean
          nationality?: string | null
          organization_id: string
          personnel_group?: string | null
          phone?: string | null
          pkv_basis_beitrag_monat_cent?: number
          place_of_birth?: string | null
          postal_code?: string | null
          pv_frei?: boolean
          rv_frei?: boolean
          sachbezug_monthly_cents?: number
          salutation?: string | null
          social_security_number?: string | null
          soll_hours_per_day?: number
          staff_id: string
          street?: string | null
          tax_class?: string | null
          tax_id?: string | null
          updated_at?: string
          vacation_days_contractual?: number | null
          vacation_days_current_year?: number | null
          vacation_days_previous_year?: number | null
          vacation_days_taken?: number | null
        }
        Update: {
          account_holder?: string | null
          address?: string | null
          av_frei?: boolean
          bank_name?: string | null
          child_tax_allowances?: number | null
          children_count?: number | null
          church_tax_liable?: boolean | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          employment_end_date?: string | null
          employment_start_date?: string | null
          has_parent_status?: boolean | null
          health_insurance?: string | null
          iban?: string | null
          id?: string
          is_midijob?: boolean
          is_minijob?: boolean | null
          is_pkv?: boolean
          is_sv_exempt?: boolean | null
          ist_werkstudent?: boolean
          job_title?: string | null
          kk_zusatzbeitrag?: number | null
          konfession?: string | null
          kv_frei?: boolean
          lst_freibetrag_monat_cent?: number
          meal_allowance?: boolean
          nationality?: string | null
          organization_id?: string
          personnel_group?: string | null
          phone?: string | null
          pkv_basis_beitrag_monat_cent?: number
          place_of_birth?: string | null
          postal_code?: string | null
          pv_frei?: boolean
          rv_frei?: boolean
          sachbezug_monthly_cents?: number
          salutation?: string | null
          social_security_number?: string | null
          soll_hours_per_day?: number
          staff_id?: string
          street?: string | null
          tax_class?: string | null
          tax_id?: string | null
          updated_at?: string
          vacation_days_contractual?: number | null
          vacation_days_current_year?: number | null
          vacation_days_previous_year?: number | null
          vacation_days_taken?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_personal_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_personal_details_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_pins: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          pin_hash: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          pin_hash: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          pin_hash?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_pins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_pins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_skills: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          skill_id: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          skill_id: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          skill_id?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_skills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_skills_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_telegram_links: {
        Row: {
          created_at: string
          id: string
          link_token_hash: string | null
          linked_at: string | null
          organization_id: string
          receives_daily_report: boolean
          receives_swap_alerts: boolean
          staff_id: string
          telegram_chat_id: number | null
          telegram_username: string | null
          token_expires_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          link_token_hash?: string | null
          linked_at?: string | null
          organization_id: string
          receives_daily_report?: boolean
          receives_swap_alerts?: boolean
          staff_id: string
          telegram_chat_id?: number | null
          telegram_username?: string | null
          token_expires_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          link_token_hash?: string | null
          linked_at?: string | null
          organization_id?: string
          receives_daily_report?: boolean
          receives_swap_alerts?: boolean
          staff_id?: string
          telegram_chat_id?: number | null
          telegram_username?: string | null
          token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_telegram_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_telegram_links_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_locations: {
        Row: {
          created_at: string
          customer_number: string | null
          id: string
          is_active: boolean
          location_id: string
          organization_id: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_number?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          organization_id: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_number?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          organization_id?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_locations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          customer_number: string | null
          delivery_days: string[] | null
          email: string | null
          first_live_order_email_at: string | null
          id: string
          is_active: boolean
          min_order_value_cents: number | null
          mobile: string | null
          name: string
          notes: string | null
          order_deadline: string | null
          organization_id: string
          phone: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          customer_number?: string | null
          delivery_days?: string[] | null
          email?: string | null
          first_live_order_email_at?: string | null
          id?: string
          is_active?: boolean
          min_order_value_cents?: number | null
          mobile?: string | null
          name: string
          notes?: string | null
          order_deadline?: string | null
          organization_id: string
          phone?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          customer_number?: string | null
          delivery_days?: string[] | null
          email?: string | null
          first_live_order_email_at?: string | null
          id?: string
          is_active?: boolean
          min_order_value_cents?: number | null
          mobile?: string | null
          name?: string
          notes?: string | null
          order_deadline?: string | null
          organization_id?: string
          phone?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_photos: {
        Row: {
          created_at: string
          id: string
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
          task_id: string
          uploaded_by_staff_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type: string
          organization_id: string
          size_bytes: number
          storage_path: string
          task_id: string
          uploaded_by_staff_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string
          organization_id?: string
          size_bytes?: number
          storage_path?: string
          task_id?: string
          uploaded_by_staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_photos_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_photos_uploaded_by_staff_id_fkey"
            columns: ["uploaded_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_staff_id?: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at?: string | null
          created_at?: string
          created_by_staff_id: string
          description?: string | null
          due_at?: string | null
          escalate_at?: string | null
          escalated_at?: string | null
          id?: string
          location_id: string
          organization_id: string
          priority?: number
          sort_order?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_staff_id?: string | null
          category?: Database["public"]["Enums"]["task_category"]
          completed_at?: string | null
          created_at?: string
          created_by_staff_id?: string
          description?: string | null
          due_at?: string | null
          escalate_at?: string | null
          escalated_at?: string | null
          id?: string
          location_id?: string
          organization_id?: string
          priority?: number
          sort_order?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_staff_id_fkey"
            columns: ["assignee_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          break_minutes: number
          business_date: string
          created_at: string
          department: Database["public"]["Enums"]["staff_department"] | null
          ended_at: string | null
          id: string
          import_key: string | null
          location_id: string | null
          organization_id: string
          source: Database["public"]["Enums"]["time_entry_source"]
          staff_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          break_minutes?: number
          business_date: string
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"] | null
          ended_at?: string | null
          id?: string
          import_key?: string | null
          location_id?: string | null
          organization_id: string
          source?: Database["public"]["Enums"]["time_entry_source"]
          staff_id: string
          started_at: string
          updated_at?: string
        }
        Update: {
          break_minutes?: number
          business_date?: string
          created_at?: string
          department?: Database["public"]["Enums"]["staff_department"] | null
          ended_at?: string | null
          id?: string
          import_key?: string | null
          location_id?: string | null
          organization_id?: string
          source?: Database["public"]["Enums"]["time_entry_source"]
          staff_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      user_links: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          staff_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          staff_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          staff_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_links_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_settlements: {
        Row: {
          additional_waiters: Json
          auto_clockout_time_entry_id: string | null
          card_total_cents: number
          cash_handed_in_cents: number
          corrected_from_id: string | null
          created_at: string
          differenz_cents: number
          hilf_mahl_cents: number
          id: string
          kassiert_brutto_cents: number
          kitchen_tip_cents: number
          kitchen_tip_rate: number
          open_invoices_cents: number
          open_invoices_details: Json
          organization_id: string
          partner_staff_id: string | null
          pos_sales_cents: number
          second_waiter_name: string | null
          session_id: string
          staff_id: string
          status: Database["public"]["Enums"]["waiter_settlement_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          additional_waiters?: Json
          auto_clockout_time_entry_id?: string | null
          card_total_cents?: number
          cash_handed_in_cents?: number
          corrected_from_id?: string | null
          created_at?: string
          differenz_cents?: number
          hilf_mahl_cents?: number
          id?: string
          kassiert_brutto_cents?: number
          kitchen_tip_cents?: number
          kitchen_tip_rate: number
          open_invoices_cents?: number
          open_invoices_details?: Json
          organization_id: string
          partner_staff_id?: string | null
          pos_sales_cents?: number
          second_waiter_name?: string | null
          session_id: string
          staff_id: string
          status?: Database["public"]["Enums"]["waiter_settlement_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          additional_waiters?: Json
          auto_clockout_time_entry_id?: string | null
          card_total_cents?: number
          cash_handed_in_cents?: number
          corrected_from_id?: string | null
          created_at?: string
          differenz_cents?: number
          hilf_mahl_cents?: number
          id?: string
          kassiert_brutto_cents?: number
          kitchen_tip_cents?: number
          kitchen_tip_rate?: number
          open_invoices_cents?: number
          open_invoices_details?: Json
          organization_id?: string
          partner_staff_id?: string | null
          pos_sales_cents?: number
          second_waiter_name?: string | null
          session_id?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["waiter_settlement_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_settlements_auto_clockout_time_entry_id_fkey"
            columns: ["auto_clockout_time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_settlements_corrected_from_id_fkey"
            columns: ["corrected_from_id"]
            isOneToOne: false
            referencedRelation: "waiter_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_settlements_partner_staff_id_fkey"
            columns: ["partner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_settlements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_settlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_quiz_scores: {
        Row: {
          correct_answers: number
          id: string
          level_reached: number
          organization_id: string
          played_at: string
          questions_answered: number
          score: number
          staff_id: string | null
          staff_name: string
        }
        Insert: {
          correct_answers?: number
          id?: string
          level_reached?: number
          organization_id: string
          played_at?: string
          questions_answered?: number
          score?: number
          staff_id?: string | null
          staff_name: string
        }
        Update: {
          correct_answers?: number
          id?: string
          level_reached?: number
          organization_id?: string
          played_at?: string
          questions_answered?: number
          score?: number
          staff_id?: string | null
          staff_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_quiz_scores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_quiz_scores_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _effective_user_id: { Args: never; Returns: string }
      approve_leave_request: {
        Args: { p_decided_by: string; p_note: string; p_request_id: string }
        Returns: undefined
      }
      archive_task: {
        Args: {
          p_caller_staff_id: string
          p_organization_id: string
          p_task_id: string
        }
        Returns: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_task: {
        Args: {
          p_caller_staff_id: string
          p_organization_id: string
          p_task_id: string
        }
        Returns: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order_from_cart: {
        Args: {
          p_notes?: string
          p_org_id: string
          p_supplier_id?: string
          p_user_id: string
        }
        Returns: string[]
      }
      create_task: {
        Args: {
          p_assignee_staff_id?: string
          p_caller_staff_id: string
          p_category: Database["public"]["Enums"]["task_category"]
          p_description: string
          p_due_at?: string
          p_location_id: string
          p_organization_id: string
          p_priority?: number
          p_title: string
        }
        Returns: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_business_date: { Args: never; Returns: string }
      current_organization_id: { Args: never; Returns: string }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_staff_id: { Args: never; Returns: string }
      execute_shift_swap: {
        Args: { p_decided_by: string; p_request_id: string }
        Returns: undefined
      }
      generate_order_number: { Args: never; Returns: string }
      has_min_permission: {
        Args: { _min: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      has_permission:
        | {
            Args: {
              _location?: string
              _perm: Database["public"]["Enums"]["app_permission"]
            }
            Returns: boolean
          }
        | {
            Args: {
              _area: Database["public"]["Enums"]["staff_department"]
              _location: string
              _perm: Database["public"]["Enums"]["app_permission"]
            }
            Returns: boolean
          }
      is_admin: { Args: never; Returns: boolean }
      is_real_admin: { Args: never; Returns: boolean }
      link_account_to_staff: {
        Args: {
          p_email: string
          p_organization_id: string
          p_staff_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      list_payslip_objects: {
        Args: { p_prefix: string }
        Returns: {
          created_at: string
          name: string
          size: number
        }[]
      }
      load_draft_into_cart: {
        Args: {
          p_cart_id: string
          p_draft_id: string
          p_organization_id: string
          p_replace: boolean
          p_user_id: string
        }
        Returns: undefined
      }
      pin_attempt_register: {
        Args: {
          p_ip: string
          p_ip_max: number
          p_organization_id: string
          p_staff_id: string
          p_staff_max: number
          p_window_ms: number
        }
        Returns: {
          attempt_id: string
          ip_failures: number
          staff_failures: number
        }[]
      }
      reassign_task: {
        Args: {
          p_caller_staff_id: string
          p_new_assignee_staff_id: string
          p_organization_id: string
          p_task_id: string
        }
        Returns: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_bilanz_year: {
        Args: {
          p_entity: string
          p_fiscal_year: number
          p_konten: Json
          p_organization_id: string
          p_positions: Json
        }
        Returns: undefined
      }
      replace_pos_hourly_stats: {
        Args: {
          p_location_id: string
          p_organization_id: string
          p_period: string
          p_report_date: string
          p_rows: Json
        }
        Returns: undefined
      }
      replace_pos_sales_stats: {
        Args: {
          p_location_id: string
          p_organization_id: string
          p_period: string
          p_report_date: string
          p_rows: Json
        }
        Returns: undefined
      }
      replace_staff_role: {
        Args: {
          p_organization_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_staff_id: string
        }
        Returns: undefined
      }
      replace_staff_skills: {
        Args: {
          p_organization_id: string
          p_skill_ids: string[]
          p_staff_id: string
        }
        Returns: undefined
      }
      save_cart_as_draft: {
        Args: {
          p_cart_id: string
          p_name: string
          p_notes: string
          p_organization_id: string
          p_user_id: string
        }
        Returns: string
      }
      set_task_status: {
        Args: {
          p_caller_staff_id: string
          p_new_status: Database["public"]["Enums"]["task_status"]
          p_organization_id: string
          p_sort_order?: number
          p_task_id: string
        }
        Returns: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_task: {
        Args: {
          p_caller_staff_id: string
          p_description: string
          p_due_at: string
          p_organization_id: string
          p_priority: number
          p_task_id: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          assignee_staff_id: string | null
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          created_by_staff_id: string
          description: string | null
          due_at: string | null
          escalate_at: string | null
          escalated_at: string | null
          id: string
          location_id: string
          organization_id: string
          priority: number
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_permission:
        | "cash.session.view"
        | "cash.session.open"
        | "cash.session.edit"
        | "cash.session.finalize"
        | "cash.session.lock"
        | "cash.settlement.submit_self"
        | "cash.settlement.view_all"
        | "cash.settlement.correct"
        | "cash.settlement.admin_create"
        | "cash.tippool.manage"
        | "cash.channel.manage"
        | "cash.export.pdf"
        | "time.entry.view_self"
        | "time.entry.view_all"
        | "time.entry.clock"
        | "time.entry.edit"
        | "time.period.view"
        | "time.period.manage"
        | "time.period.lock"
        | "time.payroll_note.view"
        | "time.payroll_note.edit"
        | "time.export"
        | "roster.shift.view_self"
        | "roster.shift.view_all"
        | "roster.shift.manage"
        | "roster.availability.manage_self"
        | "roster.availability.manage_all"
        | "roster.absence.view"
        | "roster.absence.manage"
        | "roster.wish.create_self"
        | "roster.wish.view_all"
        | "roster.wish.manage_all"
        | "roster.leave.request_self"
        | "roster.leave.view_all"
        | "roster.leave.decide"
        | "payroll.compensation.view"
        | "payroll.compensation.edit"
        | "payroll.personal.view"
        | "payroll.personal.edit"
        | "payroll.personal.import"
        | "payroll.calc.run"
        | "payroll.period.view"
        | "tasks.view"
        | "tasks.create"
        | "tasks.assign"
        | "tasks.change_status"
        | "tasks.delete"
        | "roster.swap.view_pending"
        | "roster.swap.decide"
        | "recipes.manage"
      app_role: "admin" | "manager" | "staff" | "payroll" | "planer"
      permission_effect: "allow" | "deny"
      register_transfer_direction:
        | "to_restaurant"
        | "from_restaurant"
        | "to_safe"
        | "to_other"
      session_status: "open" | "finalized" | "locked"
      skill_category: "kitchen" | "service" | "gl" | "other"
      staff_department: "kitchen" | "service" | "gl"
      task_category: "service" | "kitchen" | "maintenance" | "manager_admin"
      task_status: "open" | "in_progress" | "done" | "cancelled"
      time_entry_source: "clock" | "manual" | "import" | "pool"
      token_type: "badge_login" | "calendar_feed"
      waiter_settlement_status:
        | "draft"
        | "submitted"
        | "corrected"
        | "superseded"
        | "locked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_permission: [
        "cash.session.view",
        "cash.session.open",
        "cash.session.edit",
        "cash.session.finalize",
        "cash.session.lock",
        "cash.settlement.submit_self",
        "cash.settlement.view_all",
        "cash.settlement.correct",
        "cash.settlement.admin_create",
        "cash.tippool.manage",
        "cash.channel.manage",
        "cash.export.pdf",
        "time.entry.view_self",
        "time.entry.view_all",
        "time.entry.clock",
        "time.entry.edit",
        "time.period.view",
        "time.period.manage",
        "time.period.lock",
        "time.payroll_note.view",
        "time.payroll_note.edit",
        "time.export",
        "roster.shift.view_self",
        "roster.shift.view_all",
        "roster.shift.manage",
        "roster.availability.manage_self",
        "roster.availability.manage_all",
        "roster.absence.view",
        "roster.absence.manage",
        "roster.wish.create_self",
        "roster.wish.view_all",
        "roster.wish.manage_all",
        "roster.leave.request_self",
        "roster.leave.view_all",
        "roster.leave.decide",
        "payroll.compensation.view",
        "payroll.compensation.edit",
        "payroll.personal.view",
        "payroll.personal.edit",
        "payroll.personal.import",
        "payroll.calc.run",
        "payroll.period.view",
        "tasks.view",
        "tasks.create",
        "tasks.assign",
        "tasks.change_status",
        "tasks.delete",
        "roster.swap.view_pending",
        "roster.swap.decide",
        "recipes.manage",
      ],
      app_role: ["admin", "manager", "staff", "payroll", "planer"],
      permission_effect: ["allow", "deny"],
      register_transfer_direction: [
        "to_restaurant",
        "from_restaurant",
        "to_safe",
        "to_other",
      ],
      session_status: ["open", "finalized", "locked"],
      skill_category: ["kitchen", "service", "gl", "other"],
      staff_department: ["kitchen", "service", "gl"],
      task_category: ["service", "kitchen", "maintenance", "manager_admin"],
      task_status: ["open", "in_progress", "done", "cancelled"],
      time_entry_source: ["clock", "manual", "import", "pool"],
      token_type: ["badge_login", "calendar_feed"],
      waiter_settlement_status: [
        "draft",
        "submitted",
        "corrected",
        "superseded",
        "locked",
      ],
    },
  },
} as const
